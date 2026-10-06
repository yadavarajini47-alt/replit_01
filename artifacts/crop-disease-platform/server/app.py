from __future__ import annotations

import base64
import binascii
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge

from model_adapter import predict, recommendations_for, status as model_status

APP_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("DATA_DIR", APP_ROOT / "data"))
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", APP_ROOT / "uploads"))
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", DATA_DIR / "detections.sqlite"))
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_FORMATS = {
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".png": "PNG",
}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 14 * 1024 * 1024


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS detections (
                id TEXT PRIMARY KEY,
                image_filename TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                crop_type TEXT NOT NULL,
                farm_name TEXT,
                notes TEXT,
                status TEXT NOT NULL CHECK(status IN ('diagnosed', 'model_unavailable')),
                disease TEXT,
                confidence REAL,
                recommendations TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS detections_created_at_idx ON detections(created_at DESC)"
        )


def serialize(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "imageUrl": f"/api/uploads/{row['image_filename']}",
        "originalFilename": row["original_filename"],
        "cropType": row["crop_type"],
        "farmName": row["farm_name"],
        "notes": row["notes"],
        "status": row["status"],
        "disease": row["disease"],
        "confidence": row["confidence"],
        "recommendations": json.loads(row["recommendations"]),
        "createdAt": row["created_at"],
    }


def find_detection(detection_id: str) -> sqlite3.Row | None:
    with connect() as connection:
        return connection.execute(
            "SELECT * FROM detections WHERE id = ?", (detection_id,)
        ).fetchone()


def json_error(message: str, status_code: int):
    return jsonify({"error": message}), status_code


@app.get("/api/healthz")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/crop-diseases/model")
def get_model_status():
    return jsonify(model_status())


@app.get("/api/detections")
def list_detections():
    search = request.args.get("search", "").strip()
    crop_type = request.args.get("cropType", "").strip()
    try:
        limit = min(max(int(request.args.get("limit", "50")), 1), 100)
    except ValueError:
        return json_error("limit must be a whole number.", 400)

    clauses: list[str] = []
    values: list[Any] = []
    if search:
        clauses.append("(original_filename LIKE ? OR crop_type LIKE ? OR farm_name LIKE ? OR disease LIKE ?)")
        term = f"%{search}%"
        values.extend([term, term, term, term])
    if crop_type:
        clauses.append("crop_type = ?")
        values.append(crop_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with connect() as connection:
        rows = connection.execute(
            f"SELECT * FROM detections {where} ORDER BY created_at DESC LIMIT ?",
            (*values, limit),
        ).fetchall()
    return jsonify([serialize(row) for row in rows])


@app.post("/api/detections")
def create_detection():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return json_error("Expected a JSON image upload.", 400)

    crop_type = body.get("cropType")
    filename = body.get("originalFilename")
    image_data = body.get("imageData")
    if not isinstance(crop_type, str) or not crop_type.strip():
        return json_error("Choose a crop type.", 400)
    if not isinstance(filename, str) or not filename.strip():
        return json_error("An image filename is required.", 400)
    if not isinstance(image_data, str):
        return json_error("The image data is missing.", 400)
    if image_data.startswith("data:"):
        try:
            image_data = image_data.split(",", maxsplit=1)[1]
        except IndexError:
            return json_error("The image data URL is invalid.", 400)
    try:
        raw = base64.b64decode(image_data, validate=True)
    except (binascii.Error, ValueError):
        return json_error("The image data is not valid base64.", 400)
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        return json_error("Image must be between 1 byte and 10 MB.", 400)

    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_FORMATS:
        return json_error("Use a JPG, JPEG, or PNG leaf image.", 400)
    try:
        from io import BytesIO

        with Image.open(BytesIO(raw)) as image:
            if image.width * image.height > 40_000_000:
                return json_error("Image dimensions are too large to process.", 400)
            image.verify()
            image_format = image.format
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        return json_error("The uploaded file is not a valid image.", 400)
    if image_format != ALLOWED_FORMATS[extension]:
        return json_error("The file extension does not match the image format.", 400)

    safe_name = f"{uuid.uuid4().hex}{extension}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    image_path = UPLOAD_DIR / safe_name
    image_path.write_bytes(raw)
    detection_id = str(uuid.uuid4())
    disease = None
    confidence = None
    result_status = "model_unavailable"
    recommendations: list[str] = []
    try:
        label, score = predict(image_path)
        disease = label.replace("___", " — ").replace("_", " ")
        confidence = round(max(0.0, min(score, 1.0)), 4)
        result_status = "diagnosed"
        recommendations = recommendations_for(label)
    except RuntimeError:
        # A missing model is represented explicitly; never fabricate a result.
        result_status = "model_unavailable"

    created_at = datetime.now(UTC).isoformat()
    original_filename = Path(filename).name[:255]
    farm_name = body.get("farmName")
    notes = body.get("notes")
    farm_name = farm_name.strip()[:120] if isinstance(farm_name, str) and farm_name.strip() else None
    notes = notes.strip()[:1000] if isinstance(notes, str) and notes.strip() else None
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO detections
            (id, image_filename, original_filename, crop_type, farm_name, notes,
             status, disease, confidence, recommendations, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                detection_id,
                safe_name,
                original_filename,
                crop_type.strip()[:80],
                farm_name,
                notes,
                result_status,
                disease,
                confidence,
                json.dumps(recommendations),
                created_at,
            ),
        )
    row = find_detection(detection_id)
    if row is None:
        image_path.unlink(missing_ok=True)
        return json_error("The detection could not be saved.", 500)
    return jsonify(serialize(row)), 201


@app.get("/api/detections/<detection_id>")
def get_detection(detection_id: str):
    row = find_detection(detection_id)
    if row is None:
        return json_error("Detection not found.", 404)
    return jsonify(serialize(row))


@app.delete("/api/detections/<detection_id>")
def delete_detection(detection_id: str):
    with connect() as connection:
        row = connection.execute(
            "SELECT image_filename FROM detections WHERE id = ?", (detection_id,)
        ).fetchone()
        if row is None:
            return json_error("Detection not found.", 404)
        connection.execute("DELETE FROM detections WHERE id = ?", (detection_id,))
    (UPLOAD_DIR / row["image_filename"]).unlink(missing_ok=True)
    return "", 204


@app.get("/api/dashboard/summary")
def dashboard_summary():
    with connect() as connection:
        total = connection.execute("SELECT COUNT(*) AS count FROM detections").fetchone()["count"]
        diagnosed = connection.execute(
            "SELECT COUNT(*) AS count FROM detections WHERE status = 'diagnosed'"
        ).fetchone()["count"]
        unavailable = total - diagnosed
        distribution = connection.execute(
            """
            SELECT disease, COUNT(*) AS count FROM detections
            WHERE status = 'diagnosed' AND disease IS NOT NULL
            GROUP BY disease ORDER BY count DESC, disease ASC
            """
        ).fetchall()
        recent = connection.execute(
            "SELECT * FROM detections ORDER BY created_at DESC LIMIT 5"
        ).fetchall()
        activity_rows = connection.execute(
            """
            SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
            FROM detections WHERE created_at >= ?
            GROUP BY day ORDER BY day ASC
            """,
            ((datetime.now(UTC) - timedelta(days=6)).date().isoformat(),),
        ).fetchall()

    activity = {row["day"]: row["count"] for row in activity_rows}
    today = datetime.now(UTC).date()
    weekly_activity = [
        {
            "date": (today - timedelta(days=offset)).isoformat(),
            "count": activity.get((today - timedelta(days=offset)).isoformat(), 0),
        }
        for offset in range(6, -1, -1)
    ]
    return jsonify(
        {
            "totalDetections": total,
            "diagnosedCount": diagnosed,
            "modelUnavailableCount": unavailable,
            "diseaseDistribution": [
                {"disease": row["disease"], "count": row["count"]}
                for row in distribution
            ],
            "weeklyActivity": weekly_activity,
            "recentDetections": [serialize(row) for row in recent],
        }
    )


@app.get("/api/uploads/<path:filename>")
def uploaded_image(filename: str):
    return send_from_directory(UPLOAD_DIR, filename, max_age=3600)


@app.errorhandler(RequestEntityTooLarge)
def payload_too_large(_error):
    return json_error("Image upload is too large. The maximum request size is 14 MB.", 413)


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return json_error("API endpoint not found.", 404)
    return json_error("Not found.", 404)


initialize_database()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=False)
