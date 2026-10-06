# Add a trained crop-disease model

The detection API is wired for TensorFlow/Keras inference, but this project does
not include trained weights. Without them, uploads are saved as
`model_unavailable`; the app does not invent a disease result.

To enable inference, install a TensorFlow build compatible with the project
Python runtime, then:

1. Add a trained Keras model at `models/crop_disease.keras`.
2. Add `models/class_names.json` as an ordered JSON array whose labels exactly
   match the model output, for example:

   ```json
   ["Tomato___Early_blight", "Tomato___healthy"]
   ```

3. Train the model for RGB 224 × 224 images normalized to the 0–1 range, or
   update preprocessing in `server/model_adapter.py` to match its training.
4. Restart the API server and check the model status in the app.

Model files are ignored by Git because they can be large. Keep their ordered
class labels aligned with the model output.
