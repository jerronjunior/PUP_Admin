Detector server

1. Place your TensorFlow SavedModel converted to a TF.js `layers` model at `server/models/bin-model/` (so that `model.json` and shard files exist there).
2. Install dependencies and start the server:

```bash
cd server
npm install
npm start
```

3. Set `REACT_APP_BIN_DETECTOR_URL` in your frontend `.env` to the server base URL, e.g. `http://localhost:4001`.
