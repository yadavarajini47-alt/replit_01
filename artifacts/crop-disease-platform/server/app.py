from __future__ import annotations

import base64
import binascii
import json
import math
import os
import sqlite3
import uuid
from io import BytesIO
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from model_adapter import (
    disease_details_for,
    predict,
    status as model_status,
)

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
                image_path TEXT NOT NULL DEFAULT '',
                crop_name TEXT NOT NULL DEFAULT '',
                disease_name TEXT,
                confidence REAL,
                severity TEXT,
                symptoms TEXT NOT NULL DEFAULT '[]',
                treatment TEXT NOT NULL DEFAULT '[]',
                prevention TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                image_filename TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                crop_type TEXT NOT NULL,
                farm_name TEXT,
                notes TEXT,
                status TEXT NOT NULL CHECK(status IN ('diagnosed', 'model_unavailable')),
                disease TEXT,
                recommendations TEXT NOT NULL
            )
            """
        )
        existing = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(detections)").fetchall()
        }
        migrations = {
            "image_path": "TEXT NOT NULL DEFAULT ''",
            "crop_name": "TEXT NOT NULL DEFAULT ''",
            "disease_name": "TEXT",
            "severity": "TEXT",
            "symptoms": "TEXT NOT NULL DEFAULT '[]'",
            "treatment": "TEXT NOT NULL DEFAULT '[]'",
            "prevention": "TEXT NOT NULL DEFAULT '[]'",
        }
        for column, definition in migrations.items():
            if column not in existing:
                connection.execute(
                    f"ALTER TABLE detections ADD COLUMN {column} {definition}"
                )
        connection.execute(
            """
            UPDATE detections
            SET image_path = CASE
                    WHEN image_path IS NULL OR image_path = ''
                    THEN 'uploads/' || image_filename ELSE image_path END,
                crop_name = CASE
                    WHEN crop_name IS NULL OR crop_name = ''
                    THEN crop_type ELSE crop_name END,
                disease_name = COALESCE(disease_name, disease),
                symptoms = COALESCE(NULLIF(symptoms, ''), '[]'),
                treatment = COALESCE(NULLIF(treatment, ''), '[]'),
                prevention = COALESCE(NULLIF(prevention, ''), '[]')
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS detections_created_at_idx ON detections(created_at DESC)"
        )


def _json_list(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [entry for entry in parsed if isinstance(entry, str)]


def serialize(row: sqlite3.Row) -> dict[str, Any]:
    crop_name = row["crop_name"] or row["crop_type"]
    disease_name = row["disease_name"] or row["disease"]
    image_path = row["image_path"] or f"uploads/{row['image_filename']}"
    image_filename = Path(image_path).name
    symptoms = _json_list(row["symptoms"])
    treatment = _json_list(row["treatment"])
    prevention = _json_list(row["prevention"])
    recommendations = _json_list(row["recommendations"])
    return {
        "id": row["id"],
        "image_path": image_path,
        "crop_name": crop_name,
        "disease_name": disease_name,
        "confidence": row["confidence"],
        "severity": row["severity"],
        "symptoms": symptoms,
        "treatment": treatment,
        "prevention": prevention,
        "details_available": bool(
            disease_name and row["severity"] and symptoms and treatment and prevention
        ),
        "created_at": row["created_at"],
        "imageUrl": f"/api/uploads/{image_filename}",
        "originalFilename": row["original_filename"],
        "cropType": crop_name,
        "farmName": row["farm_name"],
        "notes": row["notes"],
        "status": row["status"],
        "disease": disease_name,
        "recommendations": recommendations or treatment + prevention,
        "createdAt": row["created_at"],
    }


def find_detection(detection_id: str) -> sqlite3.Row | None:
    with connect() as connection:
        return connection.execute(
            "SELECT * FROM detections WHERE id = ?", (detection_id,)
        ).fetchone()


def json_error(message: str, status_code: int):
    return jsonify({"error": message}), status_code


def validate_image_bytes(
    raw: bytes, filename: str, content_type: str | None = None
) -> tuple[str | None, Any | None]:
    if not raw:
        return None, json_error("The uploaded image is empty.", 400)
    if len(raw) > MAX_IMAGE_BYTES:
        return None, json_error("Images must be 10 MB or smaller.", 413)

    extension = Path(filename.replace("\\", "/")).suffix.lower()
    if extension not in ALLOWED_FORMATS:
        return None, json_error("Use a JPG, JPEG, or PNG image.", 415)

    mime_type = (content_type or "").split(";", maxsplit=1)[0].strip().lower()
    expected_mime = "image/png" if extension == ".png" else "image/jpeg"
    if mime_type and mime_type not in (expected_mime, "application/octet-stream"):
        return None, json_error("The image content type does not match its file extension.", 415)

    try:
        with Image.open(BytesIO(raw)) as image:
            image_format = image.format
            if image.width * image.height > 40_000_000:
                return None, json_error("Image dimensions are too large to process.", 400)
            image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        return None, json_error("The uploaded file is not a valid image.", 400)
    if image_format != ALLOWED_FORMATS[extension]:
        return None, json_error("The file extension does not match its image content.", 415)
    return extension, None


def _safe_original_filename(filename: str) -> str:
    return Path(filename.replace("\\", "/")).name[:255] or "leaf-image"


def _display_label(label: str) -> str:
    disease_label = label.split("___", maxsplit=1)[-1]
    return disease_label.replace("_", " ").strip()[:120]


def create_detection_record(
    raw: bytes,
    filename: str,
    crop_name: str,
    farm_name: str | None = None,
    notes: str | None = None,
    content_type: str | None = None,
):
    if not isinstance(crop_name, str) or not crop_name.strip():
        return json_error("Enter the crop name.", 400)
    extension, validation_error = validate_image_bytes(raw, filename, content_type)
    if validation_error is not None:
        return validation_error
    if extension is None:
        return json_error("The image could not be validated.", 400)

    safe_name = f"{uuid.uuid4().hex}{extension}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    image_file = UPLOAD_DIR / safe_name
    try:
        with image_file.open("xb") as saved_image:
            saved_image.write(raw)
        image_file.chmod(0o600)
    except OSError:
        image_file.unlink(missing_ok=True)
        app.logger.exception("Unable to save an uploaded crop image")
        return json_error("The image could not be saved. Please try again.", 500)

    disease_name: str | None = None
    confidence: float | None = None
    severity: str | None = None
    symptoms: list[str] = []
    treatment: list[str] = []
    prevention: list[str] = []
    result_status = "model_unavailable"
    try:
        label, score = predict(image_file)
        if not math.isfinite(score):
            raise RuntimeError("Model returned a non-finite confidence value.")
        confidence = round(max(0.0, min(score, 1.0)), 4)
        details = disease_details_for(label)
        disease_name = (
            details["disease_name"] if details else _display_label(label)
        )
        if details:
            severity = details["severity"]
            symptoms = details["symptoms"]
            treatment = details["treatment"]
            prevention = details["prevention"]
        result_status = "diagnosed"
    except RuntimeError:
        # Missing or failed model inference is recorded explicitly, never guessed.
        result_status = "model_unavailable"
        disease_name = None
        confidence = None

    crop_name = crop_name.strip()[:80]
    farm_name = farm_name.strip()[:120] if isinstance(farm_name, str) and farm_name.strip() else None
    notes = notes.strip()[:1000] if isinstance(notes, str) and notes.strip() else None
    created_at = datetime.now(UTC).isoformat()
    detection_id = str(uuid.uuid4())
    image_path = f"uploads/{safe_name}"
    original_filename = _safe_original_filename(filename)
    recommendations = treatment + prevention
    try:
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO detections (
                    id, image_path, crop_name, disease_name, confidence, severity,
                    symptoms, treatment, prevention, created_at, image_filename,
                    original_filename, crop_type, farm_name, notes, status,
                    disease, recommendations
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    detection_id,
                    image_path,
                    crop_name,
                    disease_name,
                    confidence,
                    severity,
                    json.dumps(symptoms),
                    json.dumps(treatment),
                    json.dumps(prevention),
                    created_at,
                    safe_name,
                    original_filename,
                    crop_name,
                    farm_name,
                    notes,
                    result_status,
                    disease_name,
                    json.dumps(recommendations),
                ),
            )
        row = find_detection(detection_id)
        if row is None:
            raise sqlite3.DatabaseError("The saved detection could not be read back.")
        return jsonify(serialize(row)), 201
    except sqlite3.Error:
        image_file.unlink(missing_ok=True)
        app.logger.exception("Unable to save crop detection history")
        return json_error("The detection could not be saved. Please try again.", 500)


@app.get("/api/healthz")
@app.get("/api/health")
def health():
    try:
        with connect() as connection:
            connection.execute("SELECT 1").fetchone()
    except sqlite3.Error:
        app.logger.exception("Health check could not reach SQLite")
        return jsonify({"status": "degraded", "database": "unavailable"}), 503
    return jsonify({"status": "ok", "database": "ok"})


@app.get("/api/crop-diseases/model")
def get_model_status():
    return jsonify(model_status())


@app.get("/api/detections")
@app.get("/api/history")
def list_detections():
    search = request.args.get("search", "").strip()
    crop_name = request.args.get("crop_name", request.args.get("cropType", "")).strip()
    try:
        limit = min(max(int(request.args.get("limit", "50")), 1), 100)
    except ValueError:
        return json_error("limit must be a whole number.", 400)

    clauses: list[str] = []
    values: list[Any] = []
    if search:
        clauses.append(
            "(original_filename LIKE ? OR crop_name LIKE ? OR farm_name LIKE ? OR disease_name LIKE ?)"
        )
        term = f"%{search}%"
        values.extend([term, term, term, term])
    if crop_name:
        clauses.append("crop_name = ?")
        values.append(crop_name)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with connect() as connection:
        rows = connection.execute(
            f"SELECT * FROM detections {where} ORDER BY created_at DESC LIMIT ?",
            (*values, limit),
        ).fetchall()
    return jsonify([serialize(row) for row in rows])


@app.post("/api/predict")
def predict_detection():
    image = request.files.get("image") or request.files.get("file")
    if image is None:
        return json_error("Choose a leaf image to upload in the 'image' field.", 400)
    if not image.filename:
        return json_error("The uploaded image needs a filename.", 400)
    crop_name = request.form.get("crop_name", request.form.get("cropType", ""))
    if not crop_name.strip():
        return json_error("Enter the crop name.", 400)
    raw = image.stream.read(MAX_IMAGE_BYTES + 1)
    return create_detection_record(
        raw,
        image.filename,
        crop_name,
        request.form.get("farm_name", request.form.get("farmName")),
        request.form.get("notes"),
        image.mimetype,
    )


@app.post("/api/detections")
def create_detection_legacy():
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
    if len(image_data) > ((MAX_IMAGE_BYTES + 2) // 3) * 4 + 4:
        return json_error("Images must be 10 MB or smaller.", 413)
    if image_data.startswith("data:"):
        try:
            image_data = image_data.split(",", maxsplit=1)[1]
        except IndexError:
            return json_error("The image data URL is invalid.", 400)
    try:
        raw = base64.b64decode(image_data, validate=True)
    except (binascii.Error, ValueError):
        return json_error("The image data is not valid base64.", 400)
    return create_detection_record(
        raw,
        filename,
        crop_type,
        body.get("farmName"),
        body.get("notes"),
    )


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
            "SELECT image_path, image_filename FROM detections WHERE id = ?", (detection_id,)
        ).fetchone()
        if row is None:
            return json_error("Detection not found.", 404)
        connection.execute("DELETE FROM detections WHERE id = ?", (detection_id,))
    image_filename = Path(row["image_path"] or row["image_filename"]).name
    (UPLOAD_DIR / image_filename).unlink(missing_ok=True)
    return "", 204


@app.get("/api/dashboard/summary")
@app.get("/api/statistics")
def dashboard_summary():
    with connect() as connection:
        total = connection.execute("SELECT COUNT(*) AS count FROM detections").fetchone()["count"]
        diagnosed = connection.execute(
            "SELECT COUNT(*) AS count FROM detections WHERE status = 'diagnosed'"
        ).fetchone()["count"]
        unavailable = total - diagnosed
        distribution = connection.execute(
            """
            SELECT COALESCE(disease_name, disease) AS disease_name, COUNT(*) AS count
            FROM detections
            WHERE status = 'diagnosed' AND COALESCE(disease_name, disease) IS NOT NULL
            GROUP BY COALESCE(disease_name, disease)
            ORDER BY count DESC, disease_name ASC
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
            "total_detections": total,
            "diagnosed_count": diagnosed,
            "model_unavailable_count": unavailable,
            "diseaseDistribution": [
                {"disease": row["disease_name"], "count": row["count"]}
                for row in distribution
            ],
            "weeklyActivity": weekly_activity,
            "recentDetections": [serialize(row) for row in recent],
        }
    )


@app.get("/api/uploads/<path:filename>")
def uploaded_image(filename: str):
    if Path(filename).name != filename:
        return json_error("Image not found.", 404)
    return send_from_directory(UPLOAD_DIR, filename, max_age=3600)


@app.errorhandler(RequestEntityTooLarge)
def payload_too_large(_error):
    return json_error("Image upload is too large. The maximum request size is 14 MB.", 413)


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return json_error("API endpoint not found.", 404)
    return json_error("Not found.", 404)


@app.errorhandler(Exception)
def unexpected_error(error: Exception):
    if isinstance(error, HTTPException):
        return json_error(error.description, error.code or 500)
    app.logger.exception("Unhandled API error", exc_info=error)
    return json_error("An unexpected server error occurred.", 500)


initialize_database()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=False)
