# Wink — Implementation Guide
## Items requiring your action (backend / external services)

---

## SUG #7 — Move FREE_LIMIT enforcement to the server

The `FREE_LIMIT = 4` constant in `app.js` is still display-only. The real gate must be in your FastAPI backend.

**In your `main.py` or `api.py`, on your `/upload` route:**

```python
from fastapi import HTTPException
from scripts.auth import get_current_user

@app.post("/upload")
async def upload(request: Request, files: list[UploadFile] = File(...)):
    user_id = get_current_user(request)

    # Count existing uploads for this user
    result = supabase.table("documents") \
        .select("id", count="exact") \
        .eq("user_id", user_id) \
        .execute()

    used = result.count or 0
    tier = get_user_tier(user_id)  # query your profiles table

    if tier != "pro" and used >= 4:
        raise HTTPException(
            status_code=403,
            detail="Free trial limit reached. Upgrade to Pro to continue uploading."
        )

    # ... rest of upload logic
```

Also enforce on `/upload-usage`:
```python
@app.get("/upload-usage")
async def upload_usage(request: Request):
    user_id = get_current_user(request)
    result = supabase.table("documents").select("id", count="exact").eq("user_id", user_id).execute()
    tier = get_user_tier(user_id)
    return { "used": result.count, "limit": None if tier == "pro" else 4 }
```

---

## SUG #8 — Dockerfile USER directive

Add these two lines to your `Dockerfile` before the `CMD` line:

```dockerfile
# Run as non-root user
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser
```

Your full Dockerfile `CMD` section should look like:
```dockerfile
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-en-v1.5')"

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

CMD ["python", "start.py"]
```

**Also immediately:** Check if `convert_jwk_to_pem.py` contains real JWK coordinates that were ever committed to git. If so, rotate those keys — git history is public even if the file is deleted.

---

## SUG #10 — FAISS persistence across Railway restarts

Railway's free tier cold-starts wipe in-memory state. Your `VectorStoreManager` already has `save()` and `load()` — you just need to call them at the right moments.

**In your API startup (e.g. `main.py` lifespan or `@app.on_event("startup")`):**

```python
import os
from pathlib import Path
from scripts.vector_store_manager import VectorStoreManager

STORE_PATH = Path(os.environ.get("VECTOR_STORE_DIR", "/app/vector_store"))

@app.on_event("startup")
async def startup():
    global vector_store
    index_path    = STORE_PATH / "index.faiss"
    metadata_path = STORE_PATH / "metadata.json"

    vector_store = VectorStoreManager(
        embedding_dim=384,           # matches bge-small-en-v1.5
        index_type="cosine",
        index_path=index_path,
        metadata_path=metadata_path
    )

    if index_path.exists():
        loaded = vector_store.load()
        print(f"FAISS loaded: {vector_store.get_size()} vectors" if loaded else "No existing index found, starting fresh.")
    else:
        print("No index on disk. Fresh start.")
```

**After every upload completes, call:**
```python
vector_store.save()
```

**On Railway:** Set `VECTOR_STORE_DIR=/app/vector_store` in your environment variables. Railway does NOT persist `/app` across deployments by default unless you use a Volume. Go to your Railway project → your service → **Volumes** → attach a volume mounted at `/app/vector_store`. This is the critical step — without the volume, every deployment wipes the index.

---

## SUG #11 — Partial upload failure handling

Currently if one file fails, the whole job fails. Here's the pattern to isolate failures:

**In your upload job processor:**

```python
results = []
failed  = []

for file in files:
    try:
        chunks   = chunking_engine.chunk_document(extract_text(file))
        embeddings = embedding_engine.embed(chunks)
        vector_store.add_embeddings(embeddings, chunks)
        vector_store.save()
        results.append({ "filename": file.filename, "status": "ok" })
    except Exception as e:
        failed.append({ "filename": file.filename, "error": str(e) })
        continue  # don't block other files

if failed and not results:
    # All files failed — return proper error
    return { "status": "failed", "error": f"Could not process: {', '.join(f['filename'] for f in failed)}" }

if failed:
    # Partial success — frontend can show a warning
    return {
        "status": "completed_with_warnings",
        "processed": len(results),
        "failed": failed
    }

return { "status": "completed", "processed": len(results) }
```

Then in `app.js`, in `pollUploadJob`, handle the partial case:
```js
if (job.status === "completed_with_warnings") {
  const names = job.failed.map(f => f.filename).join(", ");
  showUploadWarning(`Indexed ${job.processed} file(s). Could not process: ${names}`);
  clearPendingUpload();
  await Promise.allSettled([refreshDocuments(), updateUsage()]);
  setTimeout(() => closeUploadModal(), 1400);
  return;
}
```

---

## SUG #13 & #14 — Annual plan on Lemon Squeezy

1. Log in to **app.lemonsqueezy.com**
2. Go to **Products** → your Pro plan → **Variants**
3. Click **Add variant**
4. Set:
   - Name: `Pro Annual`
   - Billing: `Recurring`
   - Interval: `Yearly`
   - Price: `$144` (= $12/month × 12, ~37% saving vs monthly)
   - Trial: none (or 7 days if you want)
5. Copy the new variant's checkout URL
6. In `app.js`, update `goPro()` to offer both:

```js
function goPro() {
  const choice = confirm("Annual plan ($144/yr, save 37%) or monthly ($19/mo)?\n\nOK = Annual   Cancel = Monthly");
  const url = choice
    ? "https://wnkia.lemonsqueezy.com/checkout/buy/YOUR_ANNUAL_VARIANT_ID"
    : "https://wnkia.lemonsqueezy.com/checkout";
  window.open(url, "_blank", "noopener");
}
```

Or better — replace the `confirm()` with a proper modal. The account modal already shows plans; add an Annual option card there.

---

## SUG #6 — Vercel env.js injection (production pattern)

The `env.js` file approach works for local dev but on Vercel you don't want a static file with secrets. Instead:

**Option A — Vercel rewrites (simplest):**
Create `/api/env.js.js` (a serverless function):
```js
export default function handler(req, res) {
  res.setHeader("Content-Type", "application/javascript");
  res.send(`window.WINK_CONFIG = {
    API_BASE: "${process.env.WINK_API_BASE}",
    SB_URL:   "${process.env.WINK_SB_URL}",
    SB_KEY:   "${process.env.WINK_SB_KEY}"
  };`);
}
```

Then in `index.html`, change:
```html
<script src="./env.js"></script>
```
to:
```html
<script src="/api/env.js"></script>
```

Set `WINK_API_BASE`, `WINK_SB_URL`, `WINK_SB_KEY` in Vercel → Settings → Environment Variables.

**Option B — Build-time substitution:**
Use a `vercel.json` build command that runs a script to generate `env.js` from env vars before build. More complex, same result.

---

## Summary checklist

| # | Item | Action needed |
|---|------|--------------|
| 6 | Secrets in env.js | Copy `env.example.js` → `env.js`, fill values, add to `.gitignore` |
| 7 | Server-side upload gate | Add to FastAPI `/upload` route (code above) |
| 8 | Dockerfile USER + .dockerignore | Use the `.dockerignore` file provided; add USER lines to Dockerfile |
| 8 | Rotate JWK keys | If `convert_jwk_to_pem.py` had real coords in git history |
| 10 | FAISS persistence | Add Railway Volume + startup load/post-upload save (code above) |
| 11 | Partial upload failure | Update job processor + frontend poll handler (code above) |
| 13-14 | Annual Lemon Squeezy plan | Create variant in LS dashboard, update `goPro()` |
