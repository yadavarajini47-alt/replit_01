"""Optional TensorFlow/Keras inference adapter.

Place a trained `.keras` model at MODEL_PATH and its ordered class labels in
MODEL_CLASSES (comma-separated) to enable real predictions. No diagnosis is
generated when weights or TensorFlow are missing.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from PIL import Image

MODEL_PATH = Path(
    os.environ.get(
        "MODEL_PATH",
        Path(__file__).resolve().parents[1] / "models" / "crop_disease.keras",
    )
)
MODEL_CLASSES_PATH = Path(
    os.environ.get(
        "MODEL_CLASSES_PATH",
        Path(__file__).resolve().parents[1] / "models" / "class_names.json",
    )
)
DISEASE_CATALOG_PATH = Path(
    os.environ.get(
        "DISEASE_CATALOG_PATH",
        Path(__file__).resolve().parents[1] / "models" / "disease_catalog.json",
    )
)

_model: Any = None
_load_error: str | None = None


def _class_names() -> list[str]:
    if MODEL_CLASSES_PATH.is_file():
        try:
            names = json.loads(MODEL_CLASSES_PATH.read_text(encoding="utf-8"))
            if isinstance(names, list) and all(isinstance(name, str) for name in names):
                return [name for name in names if name.strip()]
        except (OSError, json.JSONDecodeError):
            return []
    return [
        item.strip()
        for item in os.environ.get("MODEL_CLASSES", "").split(",")
        if item.strip()
    ]


def _load_model() -> Any:
    global _model, _load_error
    if _model is not None:
        return _model
    if _load_error is not None:
        raise RuntimeError(_load_error)
    if not MODEL_PATH.is_file():
        _load_error = "No trained model weights are installed."
        raise RuntimeError(_load_error)
    try:
        from tensorflow.keras.models import load_model

        _model = load_model(MODEL_PATH)
    except ImportError as error:
        _load_error = "TensorFlow is not installed in this environment."
        raise RuntimeError(_load_error) from error
    except Exception as error:
        _load_error = f"The Keras model could not be loaded: {error}"
        raise RuntimeError(_load_error) from error
    return _model


def status() -> dict[str, Any]:
    ready = False
    if MODEL_PATH.is_file():
        try:
            model = _load_model()
            names = _class_names()
            output_count = int(model.output_shape[-1])
            if not names:
                raise RuntimeError("No class labels found. Add an ordered JSON array to models/class_names.json.")
            if len(names) != output_count:
                raise RuntimeError(
                    f"Found {len(names)} class labels but the model returns {output_count} classes."
                )
            ready = True
            message = "Trained weights and matching class labels are loaded."
        except (RuntimeError, TypeError, ValueError, IndexError) as error:
            message = str(error)
    else:
        message = (
            "No trained model weights are installed. "
            "Uploads can be saved, but no diagnosis will be invented."
        )
    supported_crops = sorted(
        {
            name.split("___", maxsplit=1)[0].replace("_", " ")
            for name in _class_names()
            if "___" in name
        }
    )
    if _load_error:
        ready = False
        message = _load_error
    return {
        "ready": ready,
        "engine": "TensorFlow / Keras",
        "message": message,
        "supportedCrops": supported_crops,
    }


def predict(image_path: Path) -> tuple[str, float]:
    model = _load_model()
    classes = _class_names()
    if not classes:
        raise RuntimeError(
            "No class labels found. Add an ordered JSON array to models/class_names.json."
        )
    with Image.open(image_path) as source:
        image = source.convert("RGB").resize((224, 224))
        pixels = list(image.getdata())
        import numpy as np

        batch = np.asarray(pixels, dtype="float32").reshape((1, 224, 224, 3)) / 255.0
    try:
        probabilities = model.predict(batch, verbose=0)[0]
    except Exception as error:
        raise RuntimeError(f"Keras inference failed: {error}") from error
    index = int(probabilities.argmax())
    if index >= len(classes):
        raise RuntimeError("Model output count does not match the class label list.")
    return classes[index], float(probabilities[index])


def disease_details_for(label: str) -> dict[str, Any] | None:
    """Read curator-provided disease details for a model class; never guess advice."""
    if not DISEASE_CATALOG_PATH.is_file():
        return None
    try:
        catalog = json.loads(DISEASE_CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(catalog, dict):
        return None
    entry = catalog.get(label)
    if not isinstance(entry, dict):
        return None
    severity = entry.get("severity")
    disease_name = entry.get("disease_name")
    if not isinstance(severity, str) or not severity.strip():
        return None
    if not isinstance(disease_name, str) or not disease_name.strip():
        return None
    details: dict[str, Any] = {
        "disease_name": disease_name.strip()[:120],
        "severity": severity.strip()[:40],
    }
    for field in ("symptoms", "treatment", "prevention"):
        values = entry.get(field)
        if (
            not isinstance(values, list)
            or not values
            or any(not isinstance(value, str) or not value.strip() for value in values)
        ):
            return None
        details[field] = [value.strip()[:500] for value in values[:20]]
    return details


def recommendations_for(label: str) -> list[str]:
    normalized = label.lower()
    if "healthy" in normalized:
        return [
            "Continue routine field monitoring and keep a record of any changes.",
            "Recheck nearby plants if symptoms appear.",
        ]
    return [
        "Confirm the result with a local agricultural extension officer before treatment.",
        "Avoid handling or moving affected plant material between fields.",
        "Monitor nearby plants and follow locally approved crop-protection guidance.",
    ]
