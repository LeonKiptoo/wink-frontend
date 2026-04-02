

--- FILE: .\convert_jwk_to_pem.py ---
```
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
import base64

# Your JWK values
x = "x1E6SKN4N3T0DSdiPGunOUzCcecKDpZ35NoToVhDUrU"
y = "Ok7C2sJcW5SkTFFGwt2p60l6x_GXGnI6A8PciyCTPJs"

def base64url_decode(val):
    padding = '=' * (-len(val) % 4)
    return base64.urlsafe_b64decode(val + padding)

x_bytes = base64url_decode(x)
y_bytes = base64url_decode(y)

public_numbers = ec.EllipticCurvePublicNumbers(
    int.from_bytes(x_bytes, "big"),
    int.from_bytes(y_bytes, "big"),
    ec.SECP256R1()
)

public_key = public_numbers.public_key()

pem = public_key.public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo
)

print(pem.decode())

```


--- FILE: .\debug_jwt.py ---
```
import jwt

token = "PASTE_YOUR_TOKEN_HERE"

header = jwt.get_unverified_header(token)
print(header)

```


--- FILE: .\Dockerfile ---
```
FROM python:3.11-slim as builder
WORKDIR /app
RUN apt-get update && apt-get install -y gcc g++ && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
WORKDIR /app

# System dependencies required at runtime:
#   poppler-utils  → pdf2image (OCR fallback for scanned PDFs)
#   tesseract-ocr  → pytesseract (OCR engine)
RUN apt-get update && apt-get install -y \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .

RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-en-v1.5')"

CMD ["python", "start.py"]

```


--- FILE: .\make_bundle.py ---
```
import os

def bundle_code(output_file="full_codebase.md"):
    # These are the file types the script will look for
    extensions = ('.py', '.html', '.css', '.js', 'Dockerfile')
    
    print("Starting bundle process...")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        for root, dirs, files in os.walk("."):
            # Ignore folders we don't need to send to AI
            if any(x in root for x in [".git", "venv", "__pycache__", "user_data", "vector_store"]):
                continue
                
            for file in files:
                # Check if it's a code file or the Dockerfile
                if file.endswith(extensions) or file == "Dockerfile":
                    file_path = os.path.join(root, file)
                    
                    # Add a header so Claude knows which file it's looking at
                    f.write(f"\n\n--- FILE: {file_path} ---\n")
                    
                    # Start a code block
                    f.write("```\n")
                    
                    try:
                        with open(file_path, 'r', encoding='utf-8') as code_f:
                            f.write(code_f.read())
                        print(f"Added: {file_path}")
                    except Exception as e:
                        f.write(f"// Error reading file: {e}")
                        
                    # Close the code block
                    f.write("\n```\n")
                    
    print(f"\nDone! Your entire codebase is now in: {output_file}")

if __name__ == "__main__":
    bundle_code()
```


--- FILE: .\start.py ---
```
import os
import uvicorn

port = int(os.environ.get("PORT", 8000))

if __name__ == "__main__":
    uvicorn.run(
        "scripts.main:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        timeout_keep_alive=120,
    )
```


--- FILE: .\scripts\auth.py ---
```
import os
import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL environment variable not set")

# JWKS endpoint for Supabase
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"

# Client caches the keys
jwks_client = PyJWKClient(JWKS_URL)

def get_current_user(request: Request) -> str:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = auth_header.split(" ")[1]

    try:
        # Fetch the appropriate signing key from the JWKS (handles ES256, RS256, etc.)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        # Decode and verify the token
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "HS256"],  # Supabase uses ES256, but we include both
            audience="authenticated",
            options={"verify_aud": True}
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing subject")
        return user_id
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
```


--- FILE: .\scripts\chunking_engine.py ---
```
"""
Chunking engine for splitting documents into overlapping chunks.
Maintains document IDs and creates unique chunk identifiers.
"""

import logging
import re
from typing import List, Dict

logger = logging.getLogger(__name__)


class ChunkingEngine:
    """
    Splits documents into overlapping chunks of specified token size.
    Maintains document context and generates chunk IDs.
    """
    
    def __init__(self, min_chunk_size: int = 500, max_chunk_size: int = 800,
                 overlap_ratio: float = 0.10, char_per_token: int = 4):
        """
        Initialize the chunking engine.
        
        Args:
            min_chunk_size: Minimum chunk size in tokens
            max_chunk_size: Maximum chunk size in tokens
            overlap_ratio: Overlap ratio (0.10 = 10%)
            char_per_token: Approximate characters per token for estimation
        """
        self.min_chunk_size = min_chunk_size
        self.max_chunk_size = max_chunk_size
        self.overlap_ratio = overlap_ratio
        self.char_per_token = char_per_token
        
        # Convert to characters
        self.min_chunk_chars = int(min_chunk_size * char_per_token)
        self.max_chunk_chars = int(max_chunk_size * char_per_token)
        self.overlap_chars = int(self.max_chunk_chars * overlap_ratio)
    
    def chunk_document(self, doc: Dict) -> List[Dict]:
        """
        Chunk a document into overlapping parts.
        
        Args:
            doc: Document dictionary with 'text', 'doc_id', etc.
            
        Returns:
            List of chunk dictionaries with:
            {
                "chunk_id": str,
                "doc_id": str,
                "text": str,
                "chunk_index": int,
                "token_count": int,
            }
        """
        text = doc.get("text", "")
        doc_id = doc.get("doc_id", "unknown")
        
        if not text:
            logger.warning(f"Document {doc_id} has no text")
            return []
        
        chunks = self._split_text(text)
        chunk_list = []
        
        for i, chunk_text in enumerate(chunks):
            chunk = {
                "chunk_id": f"{doc_id}_chunk_{i}",
                "doc_id": doc_id,
                "text": chunk_text,
                "chunk_index": i,
                "token_count": self._estimate_tokens(chunk_text),
            }
            chunk_list.append(chunk)
        
        logger.info(f"Created {len(chunk_list)} chunks from document {doc_id}")
        return chunk_list
    
    def chunk_documents(self, documents: List[Dict]) -> List[Dict]:
        """
        Chunk multiple documents.
        
        Args:
            documents: List of document dictionaries
            
        Returns:
            List of all chunks from all documents
        """
        all_chunks = []
        
        for doc in documents:
            chunks = self.chunk_document(doc)
            all_chunks.extend(chunks)
        
        logger.info(f"Total chunks created: {len(all_chunks)}")
        return all_chunks
    
    def _split_text(self, text: str) -> List[str]:
        """
        Split text into overlapping chunks.
        
        Strategy:
        1. Split by sentences to maintain semantic boundaries
        2. Group sentences into chunks of target size
        3. Add overlap between chunks
        """
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        # Split into sentences (simple approach)
        sentences = self._split_sentences(text)
        
        if not sentences:
            return [text] if text else []
        
        chunks = []
        current_chunk = ""
        current_chars = 0
        previous_overlap = ""
        
        for i, sentence in enumerate(sentences):
            sentence = sentence.strip()
            if not sentence:
                continue
            
            sentence_chars = len(sentence)
            
            # Add space before sentence (except first)
            if current_chunk:
                test_chunk = current_chunk + " " + sentence
            else:
                test_chunk = sentence
            
            test_chars = len(test_chunk)
            
            # Check if adding this sentence exceeds max chunk size
            if test_chars > self.max_chunk_chars and current_chunk:
                # Save current chunk with overlap
                chunks.append(current_chunk)
                previous_overlap = self._create_overlap(current_chunk)
                
                # Start new chunk with overlap
                current_chunk = previous_overlap + " " + sentence
                current_chars = len(current_chunk)
            else:
                # Add to current chunk
                current_chunk = test_chunk
                current_chars = test_chars
        
        # Add final chunk
        if current_chunk:
            chunks.append(current_chunk)
        
        return chunks
    
    def _split_sentences(self, text: str) -> List[str]:
        """
        Split text into sentences using regex.
        """
        # Split on common sentence endings
        sentences = re.split(r'(?<=[.!?])\s+', text)
        return [s for s in sentences if s.strip()]
    
    def _create_overlap(self, chunk: str) -> str:
        """
        Create overlap text from the end of a chunk.
        Returns the last portion of the chunk to use as overlap.
        """
        if len(chunk) <= self.overlap_chars:
            return chunk
        
        # Find last sentence boundary within overlap range
        overlap_start = len(chunk) - self.overlap_chars
        text_slice = chunk[overlap_start:]
        
        # Try to start from sentence boundary
        sentence_split = text_slice.rfind('. ')
        if sentence_split > 0:
            return text_slice[sentence_split + 2:]
        
        return text_slice
    
    @staticmethod
    def _estimate_tokens(text: str, char_per_token: int = 4) -> int:
        """
        Estimate token count using character count.
        Approximate: 1 token ≈ 4 characters for English text.
        """
        return max(1, len(text) // char_per_token)

```


--- FILE: .\scripts\config.py ---
```
"""DocIntel RAG++ v3.1 Configuration"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
VECTOR_STORE_DIR = BASE_DIR / "vector_store"

MIN_CHUNK_SIZE = 200
MAX_CHUNK_SIZE = 800
CHUNK_OVERLAP = 80

TOP_DOCS = 5
CHUNKS_PER_DOC = 12
FINAL_TOP_K = 8
MAX_CONTEXT_CHARS = 16000

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
RERANKER_MODEL = os.environ.get("RERANKER_MODEL", "BAAI/bge-reranker-base")
USE_RERANKER = os.environ.get("USE_RERANKER", "false").lower() == "true"
EMBEDDING_BATCH_SIZE = int(os.environ.get("EMBEDDING_BATCH_SIZE", "4"))

GROQ_MODEL = "llama-3.1-8b-instant"
MAX_ANSWER_TOKENS = 1500
MAX_UPLOAD_FILE_SIZE_MB = int(os.environ.get("MAX_UPLOAD_FILE_SIZE_MB", "10"))
MAX_UPLOAD_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024

```


--- FILE: .\scripts\context_builder.py ---
```
"""
Context Builder — groups chunks by document, builds structured context string.
"""
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

class ContextBuilder:
    def __init__(self, max_context_chars=16000, include_summaries=True):
        self.max_context_chars = max_context_chars
        self.include_summaries = include_summaries

    def build_context(self, chunks: List[dict], query: str = "") -> dict:
        if not chunks:
            return self._empty(query)

        by_doc: Dict[str, dict] = {}
        ungrouped = []

        for chunk in chunks:
            doc_id = chunk.get("_doc_id") or chunk.get("doc_id", "")
            filename = chunk.get("_doc_filename") or chunk.get("doc_id", "unknown")
            summary = chunk.get("_doc_summary", "")
            if doc_id:
                if doc_id not in by_doc:
                    by_doc[doc_id] = {"doc_id": doc_id, "filename": filename,
                                       "summary": summary, "chunks": []}
                by_doc[doc_id]["chunks"].append(chunk)
            else:
                ungrouped.append(chunk)

        if ungrouped and not by_doc:
            by_doc["document"] = {"doc_id": "document", "filename": "Document",
                                   "summary": "", "chunks": ungrouped}

        context_parts = []
        total_chars = 0
        final_docs = []
        final_chunks = []

        for doc_id, info in by_doc.items():
            parts = [f"=== DOCUMENT: {info['filename']} ==="]
            if self.include_summaries and info["summary"]:
                parts.append(f"[Summary: {info['summary'][:400]}]")
            for chunk in info["chunks"]:
                text = chunk.get("text", "")
                if text:
                    parts.append(text)
                    final_chunks.append(chunk)

            doc_text = "\n\n".join(parts)
            if total_chars + len(doc_text) > self.max_context_chars:
                remaining = self.max_context_chars - total_chars
                if remaining > 500:
                    context_parts.append(doc_text[:remaining] + "\n[... truncated]")
                break

            context_parts.append(doc_text)
            total_chars += len(doc_text)
            final_docs.append({**info, "chunks": info["chunks"]})

        context_str = "\n\n".join(context_parts).strip()
        return {
            "query": query, "documents": final_docs,
            "context": context_str, "chunks": final_chunks,
            "statistics": {
                "total_chunks_retrieved": len(chunks),
                "chunks_in_context": len(final_chunks),
                "documents_in_context": len(final_docs),
                "context_chars": len(context_str),
            },
        }

    def build_multi_doc_context(self, per_doc_chunks: Dict[str, List[dict]],
                                 doc_metadata: Dict[str, dict], query: str = "") -> dict:
        documents = []
        all_chunks = []
        chars_per_doc = self.max_context_chars // max(len(per_doc_chunks), 1)

        for doc_id, chunks in per_doc_chunks.items():
            meta = doc_metadata.get(doc_id, {})
            filename = meta.get("filename", doc_id)
            summary = meta.get("summary", "")
            parts = [f"=== DOCUMENT: {filename} ==="]
            if summary:
                parts.append(f"[Summary: {summary[:400]}]")
            doc_chars = 0
            included = []
            for chunk in chunks:
                text = chunk.get("text", "")
                if doc_chars + len(text) > chars_per_doc:
                    break
                parts.append(text)
                doc_chars += len(text)
                included.append(chunk)
                all_chunks.append(chunk)

            context_text = "\n\n".join(parts)
            documents.append({
                "doc_id": doc_id, "filename": filename, "summary": summary,
                "chunks": included, "context_text": context_text,
            })

        return {
            "query": query, "documents": documents,
            "context": "\n\n".join(d["context_text"] for d in documents),
            "chunks": all_chunks,
            "statistics": {"documents_in_context": len(documents),
                           "chunks_in_context": len(all_chunks)},
        }

    def _empty(self, query):
        return {"query": query, "documents": [], "context": "", "chunks": [],
                "statistics": {"total_chunks_retrieved": 0, "chunks_in_context": 0,
                               "documents_in_context": 0, "context_chars": 0}}

```


--- FILE: .\scripts\document_loader.py ---
```
"""
Document loader module - comprehensive extraction from virtually any file type.
Merges Version 1 extraction quality (heading detection, section tracking, OCR fallback)
with Version 2 architecture (class-based, FAISS-compatible output).

Supported formats:
    Rich formats:   PDF, DOCX, XLSX, XLS, PPTX, CSV
    Text formats:   TXT, MD, RST, HTML, HTM, XML, JSON, YAML, YML, TOML, INI, CFG
    Code formats:   PY, JS, TS, JAVA, C, CPP, H, CS, GO, RS, RB, PHP, SWIFT, KT, R, SQL
    Data formats:   EPUB, RTF, ODT, ODS, ODP
    Fallback:       Any other text-based file via raw UTF-8 read
"""

import json
import logging
import re
import csv
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1000  # characters per chunk (Version 1 proven value)

# ---------------------------------------------------------------------------
# Optional imports — fail gracefully if library not installed
# ---------------------------------------------------------------------------

try:
    import PyPDF2
except ImportError:
    PyPDF2 = None

try:
    import fitz  # PyMuPDF fallback for PDFs
except ImportError:
    fitz = None

try:
    from pdf2image import convert_from_path
    import pytesseract
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

try:
    from docx import Document as DocxDocument
except ImportError:
    DocxDocument = None

try:
    import openpyxl
except ImportError:
    openpyxl = None

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    from pptx import Presentation
except ImportError:
    Presentation = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    import ebooklib
    from ebooklib import epub
except ImportError:
    ebooklib = None
    epub = None

try:
    import striprtf.striprtf as striprtf_module
except ImportError:
    striprtf_module = None


# ---------------------------------------------------------------------------
# Chunking helper (from Version 1)
# ---------------------------------------------------------------------------

def _chunk_text(text: str, source_name: str, page_num: int,
                section: Optional[str] = None) -> List[Dict]:
    """Split text into fixed-size chunks, preserving source/page/section metadata."""
    chunks = []
    text = text.strip().replace("\n", " ")
    text = re.sub(r'\s+', ' ', text)
    if not text:
        return chunks
    for i in range(0, len(text), CHUNK_SIZE):
        chunk = text[i:i + CHUNK_SIZE]
        if chunk.strip():
            chunks.append({
                "source": source_name,
                "page": page_num,
                "section": section,
                "text": chunk,
            })
    return chunks


# ---------------------------------------------------------------------------
# Heading detectors (from Version 1)
# ---------------------------------------------------------------------------

def _detect_heading_pdf(line: str) -> Optional[str]:
    line = line.strip()
    if not line:
        return None
    if line.isupper() and len(line) > 3:
        return line
    if line.endswith(":") and len(line) < 80:
        return line
    return None


def _detect_heading_docx(paragraph) -> Optional[str]:
    if "Heading" in paragraph.style.name:
        return paragraph.text.strip() or None
    return None


# ---------------------------------------------------------------------------
# Per-format extractors
# ---------------------------------------------------------------------------

def _extract_pdf(file_path: Path) -> List[Dict]:
    chunks = []
    name = file_path.name

    # Try PyPDF2 first (Version 1 approach)
    if PyPDF2:
        try:
            with open(file_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                for page_num, page in enumerate(reader.pages, start=1):
                    text = page.extract_text() or ""
                    section = None
                    if text.strip():
                        for line in text.split("\n"):
                            h = _detect_heading_pdf(line)
                            if h:
                                section = h
                        chunks.extend(_chunk_text(text, name, page_num, section))
                    elif OCR_AVAILABLE:
                        images = convert_from_path(file_path, first_page=page_num, last_page=page_num)
                        for img in images:
                            ocr_text = pytesseract.image_to_string(img)
                            chunks.extend(_chunk_text(ocr_text, name, page_num, section))
            if chunks:
                return chunks
        except Exception as e:
            logger.warning(f"PyPDF2 failed for {name}: {e}, trying PyMuPDF...")

    # Fallback to PyMuPDF
    if fitz:
        try:
            doc = fitz.open(file_path)
            for page_num in range(len(doc)):
                text = doc[page_num].get_text()
                chunks.extend(_chunk_text(text, name, page_num + 1))
            doc.close()
            return chunks
        except Exception as e:
            logger.error(f"PyMuPDF also failed for {name}: {e}")

    logger.error(f"Could not extract PDF: {name}")
    return chunks


def _extract_docx(file_path: Path) -> List[Dict]:
    chunks = []
    name = file_path.name
    if not DocxDocument:
        logger.error("python-docx not installed")
        return chunks
    try:
        doc = DocxDocument(file_path)
        section = None
        for i, para in enumerate(doc.paragraphs, start=1):
            h = _detect_heading_docx(para)
            if h:
                section = h
            if para.text.strip():
                chunks.extend(_chunk_text(para.text, name, i, section))
        # Extract tables
        for table_num, table in enumerate(doc.tables, start=1):
            for row_num, row in enumerate(table.rows, start=1):
                row_text = " | ".join(
                    cell.text.strip() for cell in row.cells if cell.text.strip()
                )
                if row_text:
                    chunks.extend(_chunk_text(row_text, f"{name}:Table{table_num}", row_num))
    except Exception as e:
        logger.error(f"DOCX extraction failed for {name}: {e}")
    return chunks


def _extract_xlsx(file_path: Path) -> List[Dict]:
    chunks = []
    name = file_path.name
    if not openpyxl:
        logger.error("openpyxl not installed")
        return chunks
    try:
        wb = openpyxl.load_workbook(file_path, data_only=True)
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            # Group rows in batches of 20 so related data stays together
            row_buffer = []
            chunk_num = 1
            for row in sheet.iter_rows(values_only=True):
                row_text = " | ".join(str(cell) for cell in row if cell is not None)
                if row_text.strip():
                    row_buffer.append(row_text)
                if len(row_buffer) >= 20:
                    combined = " \n ".join(row_buffer)
                    chunks.extend(_chunk_text(combined, name, chunk_num, section=sheet_name))
                    chunk_num += 1
                    row_buffer = []
            # Flush any remaining rows
            if row_buffer:
                combined = " \n ".join(row_buffer)
                chunks.extend(_chunk_text(combined, name, chunk_num, section=sheet_name))
    except Exception as e:
        logger.error(f"XLSX extraction failed for {name}: {e}")
    return chunks


def _extract_csv(file_path: Path) -> List[Dict]:
    chunks = []
    name = file_path.name
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            reader = csv.reader(f)
            for row_num, row in enumerate(reader, start=1):
                row_text = " | ".join(str(cell) for cell in row if cell)
                if row_text.strip():
                    chunks.extend(_chunk_text(row_text, name, row_num))
    except Exception as e:
        logger.error(f"CSV extraction failed for {name}: {e}")
    return chunks


def _extract_pptx(file_path: Path) -> List[Dict]:
    chunks = []
    name = file_path.name
    if not Presentation:
        logger.error("python-pptx not installed")
        return chunks
    try:
        prs = Presentation(file_path)
        for slide_num, slide in enumerate(prs.slides, start=1):
            slide_text = []
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text.strip():
                    slide_text.append(shape.text.strip())
            if slide_text:
                combined = " ".join(slide_text)
                chunks.extend(_chunk_text(combined, name, slide_num))
    except Exception as e:
        logger.error(f"PPTX extraction failed for {name}: {e}")
    return chunks


def _extract_html(file_path: Path) -> List[Dict]:
    chunks = []
    name = file_path.name
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        if BeautifulSoup:
            soup = BeautifulSoup(content, 'html.parser')
            text = soup.get_text(separator=' ')
        else:
            # Strip tags with regex if BeautifulSoup not available
            text = re.sub(r'<[^>]+>', ' ', content)
        chunks.extend(_chunk_text(text, name, 1))
    except Exception as e:
        logger.error(f"HTML extraction failed for {name}: {e}")
    return chunks


def _extract_epub(file_path: Path) -> List[Dict]:
    chunks = []
    name = file_path.name
    if not ebooklib:
        logger.error("ebooklib not installed: pip install EbookLib")
        return chunks
    try:
        book = epub.read_epub(str(file_path))
        page_num = 1
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_DOCUMENT:
                content = item.get_content().decode('utf-8', errors='ignore')
                if BeautifulSoup:
                    soup = BeautifulSoup(content, 'html.parser')
                    text = soup.get_text(separator=' ')
                else:
                    text = re.sub(r'<[^>]+>', ' ', content)
                chunks.extend(_chunk_text(text, name, page_num))
                page_num += 1
    except Exception as e:
        logger.error(f"EPUB extraction failed for {name}: {e}")
    return chunks


def _extract_rtf(file_path: Path) -> List[Dict]:
    chunks = []
    name = file_path.name
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        if striprtf_module:
            text = striprtf_module.rtf_to_text(content)
        else:
            # Rough RTF stripping
            text = re.sub(r'\\[a-z]+\d* ?', ' ', content)
            text = re.sub(r'[{}]', '', text)
        chunks.extend(_chunk_text(text, name, 1))
    except Exception as e:
        logger.error(f"RTF extraction failed for {name}: {e}")
    return chunks


def _extract_text(file_path: Path) -> List[Dict]:
    """Generic extractor for plain text, code, markdown, JSON, YAML, etc."""
    chunks = []
    name = file_path.name
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            text = f.read()
        chunks.extend(_chunk_text(text, name, 1))
    except Exception as e:
        logger.error(f"Text extraction failed for {name}: {e}")
    return chunks


# ---------------------------------------------------------------------------
# Format routing table
# ---------------------------------------------------------------------------

TEXT_EXTENSIONS = {
    # Plain text
    '.txt', '.md', '.rst', '.log', '.text',
    # Code
    '.py', '.js', '.ts', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
    '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.r', '.sql', '.sh',
    '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.lua', '.pl', '.scala',
    '.dart', '.vue', '.jsx', '.tsx', '.coffee',
    # Data / config
    '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
    '.xml', '.svg',
}

FORMAT_HANDLERS = {
    '.pdf':  _extract_pdf,
    '.docx': _extract_docx,
    '.doc':  _extract_docx,
    '.xlsx': _extract_xlsx,
    '.xls':  _extract_xlsx,
    '.csv':  _extract_csv,
    '.pptx': _extract_pptx,
    '.ppt':  _extract_pptx,
    '.html': _extract_html,
    '.htm':  _extract_html,
    '.epub': _extract_epub,
    '.rtf':  _extract_rtf,
}


def _extract_file(file_path: Path) -> List[Dict]:
    suffix = file_path.suffix.lower()
    if suffix in FORMAT_HANDLERS:
        return FORMAT_HANDLERS[suffix](file_path)
    if suffix in TEXT_EXTENSIONS:
        return _extract_text(file_path)
    # Last resort — try reading as text anyway
    logger.warning(f"Unknown type {suffix} for {file_path.name}, attempting raw text read")
    return _extract_text(file_path)


# ---------------------------------------------------------------------------
# DocumentLoader class (V2 interface — returns doc dicts compatible with
# ChunkingEngine / EmbeddingEngine / VectorStoreManager)
# ---------------------------------------------------------------------------

class DocumentLoader:
    """
    Loads virtually any document type and returns a list of document dicts.
    Each dict is compatible with the rest of the V2 pipeline.
    """

    def __init__(self):
        pass

    def load_document(self, file_path: str) -> Optional[Dict]:
        file_path = Path(file_path)
        if not file_path.exists():
            logger.error(f"File not found: {file_path}")
            return None

        raw_chunks = _extract_file(file_path)
        if not raw_chunks:
            logger.warning(f"No content extracted from {file_path.name}")
            return None

        # Combine all chunks into a single document text
        # (ChunkingEngine will re-chunk; raw_chunks preserve page/section info
        #  which we embed into the text so context isn't lost)
        full_text_parts = []
        for chunk in raw_chunks:
            section = chunk.get("section")
            page = chunk.get("page", 1)
            text = chunk.get("text", "").strip()
            if section:
                full_text_parts.append(f"[Section: {section} | Page: {page}] {text}")
            else:
                full_text_parts.append(f"[Page: {page}] {text}")

        full_text = "\n".join(full_text_parts)

        doc_id = self._generate_doc_id(file_path)

        return {
            "doc_id": doc_id,
            "filename": file_path.name,
            "text": full_text,
            "metadata": {
                "format": file_path.suffix.lower().lstrip('.'),
                "file_size": file_path.stat().st_size,
                "raw_chunk_count": len(raw_chunks),
            },
        }

    def load_directory(self, directory_path: str) -> List[Dict]:
        directory = Path(directory_path)
        documents = []

        if not directory.is_dir():
            logger.error(f"Not a directory: {directory_path}")
            return documents

        for file_path in directory.iterdir():
            if file_path.is_file() and not file_path.name.startswith('.'):
                doc = self.load_document(file_path)
                if doc:
                    documents.append(doc)
                    logger.info(f"Loaded: {file_path.name}")
                else:
                    logger.warning(f"Skipped (no content): {file_path.name}")

        logger.info(f"Loaded {len(documents)} documents from {directory_path}")
        return documents

    @staticmethod
    def _generate_doc_id(file_path: Path) -> str:
        mtime = file_path.stat().st_mtime
        return f"{file_path.stem}_{int(mtime)}"
```


--- FILE: .\scripts\embedding_engine.py ---
```
"""
Embedding Engine — BGE-M3 with query instruction prefix.
"""
import logging
import numpy as np
from typing import List

logger = logging.getLogger(__name__)
QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "

class EmbeddingEngine:
    def __init__(self, model_name="BAAI/bge-m3", batch_size=8, device="cpu"):
        from sentence_transformers import SentenceTransformer
        self.model_name = model_name
        self.batch_size = batch_size
        self.device = device
        logger.info(f"Loading embedding model: {model_name}")
        self.model = SentenceTransformer(model_name, device=device)
        self.embedding_dim = self.model.get_sentence_embedding_dimension()
        logger.info(f"Embedding dim: {self.embedding_dim}")

    def embed_query(self, query: str) -> np.ndarray:
        return self.model.encode(
            [QUERY_INSTRUCTION + query], batch_size=1,
            show_progress_bar=False, convert_to_numpy=True, normalize_embeddings=True
        )[0]

    def embed_texts(self, texts: List[str], normalize=True) -> np.ndarray:
        if not texts:
            return np.array([])
        return self.model.encode(
            texts, batch_size=self.batch_size, show_progress_bar=False,
            convert_to_numpy=True, normalize_embeddings=normalize
        )

    def embed_chunks(self, chunks: List[dict], normalize=True) -> List[dict]:
        if not chunks:
            return chunks
        texts = [c.get("text", "") for c in chunks]
        logger.info(f"Embedding {len(texts)} chunks")
        embeddings = self.embed_texts(texts, normalize=normalize)
        for i, chunk in enumerate(chunks):
            chunk["embedding"] = embeddings[i]
        return chunks

    def embed_document(self, text: str) -> np.ndarray:
        return self.embed_texts([text[:8000]], normalize=True)[0]

    def get_model_info(self):
        return {"model_name": self.model_name, "embedding_dim": self.embedding_dim}

```


--- FILE: .\scripts\generation_engine.py ---
```
"""
Generation Engine — Wink RAG++ v3.1
Structured prompts for every quick-action button.
Each function returns predictable, high-quality, grounded output.
"""

import logging
import time
from typing import List, Dict, Optional
from groq import Groq

logger = logging.getLogger(__name__)

# ── Lens personas ─────────────────────────────────────────────────────────────

LENS_PERSONAS = {
    "general": (
        "You are an expert document analyst. Provide clear, structured answers "
        "grounded entirely in the provided document content. Be thorough and precise."
    ),
    "research": (
        "You are a rigorous academic research assistant. Synthesize information "
        "precisely, highlight methodologies and theoretical frameworks, cite sections, "
        "and flag contradictions or gaps in the evidence."
    ),
    "contract": (
        "You are a meticulous legal document analyst. Identify clauses, obligations, "
        "rights, liabilities, and risks precisely. Flag ambiguous language. "
        "Never speculate beyond what the document states."
    ),
    "medical": (
        "You are a clinical document analyst. Summarise findings accurately, highlight "
        "metrics, dosages, diagnoses, and recommendations. Note when professional "
        "verification is required."
    ),
}

# ── PROMPT TEMPLATES ──────────────────────────────────────────────────────────

# Standard Q&A
ANSWER_PROMPT = """You are Wink — a document intelligence system.
Role: {persona}

DOCUMENT CONTEXT:
{context}

QUESTION: {query}

Respond in this exact format:

**Direct Answer**
[One clear sentence directly answering the question]

**Evidence Highlights**
[3-5 bullet points with the most relevant evidence, facts, or claims from the document context]

**Why It Matters**
[1 short paragraph explaining the significance of the answer for the reader's task]

**Source**
[Document name, section, or page reference]

Rules: Use ONLY the document context. Never fabricate. If insufficient information exists, say so."""

# Methodology extraction
METHODOLOGY_PROMPT = """You are Wink — an academic document analyst.

DOCUMENT CONTEXT:
{context}

Extract the complete research methodology from this document.

Return this exact structure:

**Methodology Card**

| Field | Content |
|-------|---------|
| Research Design | [experimental / qualitative / quantitative / mixed / case study / survey / etc.] |
| Methodology | [specific methods — e.g. thematic analysis, regression, interviews] |
| Sample Size | [exact number — write N/A if not stated] |
| Sampling Method | [random / purposive / convenience / snowball / etc.] |
| Data Collection | [how data was gathered — surveys, observations, secondary data, etc.] |
| Analysis Technique | [how data was analysed] |
| Tools / Software | [any tools mentioned — SPSS, NVivo, R, etc. — N/A if none] |
| Timeframe | [study period if mentioned] |

**Methodological Strengths**
[What makes this methodology appropriate for the research questions]

**Methodological Limitations**
[Weaknesses or constraints of the approach as stated in the document]

**Source**
[Section and page numbers where methodology is described]

Extract ONLY what is explicitly stated. Write N/A for any field not mentioned."""

# Findings extraction
FINDINGS_PROMPT = """You are Wink — an academic document analyst.

DOCUMENT CONTEXT:
{context}

Extract all key findings and results from this document.

Return this exact structure:

**Findings Card**

**Primary Results**
[The main findings, numbered. Include specific statistics, percentages, or measurements where stated]

**Supporting Evidence**
[The data or evidence cited to support each major finding]

**Conclusions Drawn**
[What the authors conclude from the findings]

**Practical Implications**
[Real-world applications or recommendations stated in the document]

**Statistical Significance**
[Any p-values, confidence intervals, or significance levels mentioned — N/A if none]

**Source**
[Sections or pages where findings appear]

Be specific. Include numbers where present. Extract ONLY what the document states."""

# Key insights
INSIGHTS_PROMPT = """You are Wink — a document intelligence system.

DOCUMENT CONTEXT:
{context}

Extract the 5-7 most important insights from this document.

Return this exact structure:

**Key Insights**

For each insight, follow this format:
**Insight [N]: [Short title]**
[2-3 sentences explaining the insight and its significance. Quote or closely reference the document.]
*Source: [document section or page]*

After all insights:

**Why These Matter**
[One paragraph explaining the collective significance of these insights]

Focus on insights that are non-obvious, evidence-backed, and actionable. Not summaries — insights."""

# Limitations
LIMITATIONS_PROMPT = """You are Wink — an academic document analyst.

DOCUMENT CONTEXT:
{context}

Identify all limitations discussed in this document.

Return this exact structure:

**Limitations Analysis**

**Stated Limitations**
[Limitations explicitly acknowledged by the authors, numbered]

**Methodological Constraints**
[Specific methodological weaknesses that affect the findings]

**Sample & Scope Limitations**
[Issues with sample size, representativeness, or scope of the study]

**Generalisability**
[Can the findings be applied beyond this specific context? What does the document say?]

**Data Limitations**
[Issues with data quality, availability, or collection]

**Future Research Suggested**
[What the authors recommend for future studies to address these limitations]

**Source**
[Sections where limitations are discussed]

Extract ONLY what the document explicitly states or implies about its own limitations."""

# Research gap
GAP_PROMPT = """You are Wink — an academic document analyst.

DOCUMENT CONTEXT:
{context}

Identify the research gaps this document addresses and reveals.

Return this exact structure:

**Research Gap Analysis**

**Gap This Study Addresses**
[What problem or knowledge gap motivated this research, as stated in the document]

**Prior Literature Gaps**
[Weaknesses in previous research identified by this document]

**Remaining Unanswered Questions**
[Questions that this study raises but does not fully answer]

**What Is Still Unknown**
[Areas the authors explicitly flag as requiring further investigation]

**Opportunity for Future Research**
[Specific directions the document suggests for future work]

**Source**
[Introduction, literature review, or conclusion sections where gaps are discussed]

Ground every point in what the document explicitly states."""

# Key terms / definitions
DEFINITIONS_PROMPT = """You are Wink — a document intelligence system.

DOCUMENT CONTEXT:
{context}

Extract all key terms, concepts, and definitions from this document.

Return this exact structure:

**Key Terms & Definitions**

For each term:
**[Term]**
Definition: [as defined or used in this document]
Context: [how it is used in the argument or analysis]

After all terms:

**Conceptual Framework**
[How these key concepts relate to each other in this document's argument]

Focus on: technical terms, theoretical concepts, domain-specific language, and any terms the authors define explicitly."""

READING_CARD_PROMPT = """You are Wink — a document intelligence system.
Role: {persona}

DOCUMENT CONTENT:
{context}

Create a structured reading card for this document.

Return this exact structure:

**Reading Card**

| Field | Content |
|-------|---------|
| Document Type | [paper, policy, report, thesis chapter, article, guideline, etc.] |
| Central Question | [the main problem, argument, or research question] |
| Method / Basis | [methodology, evidence base, or reasoning approach] |
| Core Takeaway | [the most important conclusion in one sentence] |
| Why It Matters | [why a researcher or reader should care] |
| Use This When | [the kind of task or project this document helps with] |

**Key Takeaways**
[3-5 concise numbered takeaways]

**Reader Cautions**
[limitations, caveats, or assumptions to keep in mind]

**Source**
[Document name, section, or page reference]"""

# Document overview / summary
OVERVIEW_PROMPT = """You are Wink — a document intelligence system.
Role: {persona}

DOCUMENT CONTENT:
{context}

Provide a structured document overview:

**Reading Snapshot**

| Field | Content |
|-------|---------|
| Document Type | [paper, report, policy, article, thesis chapter, etc.] |
| Main Objective | [what the document is trying to do] |
| Best For | [who this is most useful for] |
| Fast Take | [one-sentence summary of the document's value] |

**What This Covers**
[4-6 key themes or topics in concise prose]

**Core Argument or Purpose**
[What the document is trying to establish, prove, or communicate]

**Key Findings or Conclusions**
[The main takeaways — be specific]

**Document Structure**
[How the document is organised — sections, chapters, flow]

**Suggested Questions to Ask**
[5 high-value questions a reader should ask about this document]"""

LITERATURE_NOTES_PROMPT = """You are Wink — an academic document analyst.

DOCUMENT CONTEXT:
{context}

Create literature-review notes for this document.

Return this exact structure:

**Literature Review Notes**

**What This Source Contributes**
[2-3 sentences on what this source adds to the literature]

**Where It Fits**
[Explain whether it extends, confirms, challenges, or reframes prior work]

**How You Could Use It**
[3 concrete ways a student or researcher could use this source in a literature review]

**Notable Evidence**
[3-5 bullet points with data, arguments, or claims worth citing]

**Cautions**
[limitations, assumptions, or scope boundaries to remember]

**Citation Anchor**
[A short sentence summarising how you would reference this source in a review]"""

# Multi-document comparison
MULTI_DOC_PROMPT = """You are Wink — a multi-document intelligence system.
Role: {persona}

You are analysing {doc_count} documents. Read ALL of them before responding.

{doc_sections}

QUESTION: {query}

Respond in this exact structure:

**Multi-Document Analysis**

**Overview**
[2-3 sentences on what these documents collectively cover]

**Comparison Matrix**
| Document | Aim / Topic | Method / Basis | Core Finding | Limitation / Caveat |
|----------|-------------|----------------|--------------|---------------------|
[One row per document. Every row must name the document explicitly.]

**Per-Document Summary**
{per_doc_template}

**Shared Themes**
[Themes, findings, or arguments that appear across multiple documents — be specific]

**Key Differences**
[Significant differences in approach, findings, or conclusions — cite which document differs]

**Contradictions**
[Any direct conflicts between documents — specify exactly what contradicts what]

**Best Next Move**
[Explain what a researcher should read, compare, or verify next based on these documents]

**Synthesis**
[Concluding paragraph directly answering the question, drawing from all documents with specific citations]

Rules: Address EVERY document by name. Never fabricate. Be specific."""

# Document summary for routing (lightweight)
ROUTING_SUMMARY_PROMPT = """Read the following document excerpt and write a concise summary (3-5 sentences) 
capturing: document type, main topic, key arguments or findings, and target audience.

DOCUMENT:
{text}

Write only the summary. No preamble."""

# No documents loaded
NO_DOCS_PROMPT = """{persona}

The user has not uploaded any documents. Answer using general knowledge and make this clear.

Question: {query}

**Answer** (general knowledge — no documents loaded)
[Your answer]

**Note**
Upload a document to get specific, cited answers from your actual content."""


class GenerationEngine:
    def __init__(self, api_key: str, model_name: str = "llama-3.1-8b-instant"):
        self.client = Groq(api_key=api_key)
        self.model_name = model_name
        logger.info(f"GenerationEngine ready: {model_name}")

    def _call(self, prompt: str, max_tokens: int = 1500,
              temperature: float = 0.15) -> str:
        """Low temperature = more grounded, less hallucination."""
        started = time.perf_counter()
        try:
            r = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            logger.info(
                "Groq completion model=%s max_tokens=%s duration=%.2fs",
                self.model_name,
                max_tokens,
                time.perf_counter() - started,
            )
            return r.choices[0].message.content.strip()
        except Exception as e:
            logger.error(
                "Generation error model=%s duration=%.2fs error=%s",
                self.model_name,
                time.perf_counter() - started,
                e,
            )
            return f"**Error**\nGeneration failed: {str(e)}\nPlease try again."

    def generate_answer(self, query: str, context: str,
                        mode: str = "general") -> str:
        if not context.strip():
            return (
                "**Direct Answer**\nNo relevant content found in your documents.\n\n"
                "**Suggestion**\nTry rephrasing, or upload more relevant documents."
            )
        persona = LENS_PERSONAS.get(mode, LENS_PERSONAS["general"])
        return self._call(
            ANSWER_PROMPT.format(persona=persona, context=context, query=query),
            max_tokens=1500
        )

    def extract_methodology(self, context: str) -> str:
        if not context.strip():
            return "No methodology content found in uploaded documents."
        return self._call(METHODOLOGY_PROMPT.format(context=context), max_tokens=1200)

    def extract_findings(self, context: str) -> str:
        if not context.strip():
            return "No findings content found in uploaded documents."
        return self._call(FINDINGS_PROMPT.format(context=context), max_tokens=1200)

    def extract_insights(self, context: str) -> str:
        if not context.strip():
            return "No content found to extract insights from."
        return self._call(INSIGHTS_PROMPT.format(context=context), max_tokens=1200)

    def extract_limitations(self, context: str) -> str:
        if not context.strip():
            return "No limitations content found in uploaded documents."
        return self._call(LIMITATIONS_PROMPT.format(context=context), max_tokens=1000)

    def extract_research_gap(self, context: str) -> str:
        if not context.strip():
            return "No research gap information found."
        return self._call(GAP_PROMPT.format(context=context), max_tokens=1000)

    def extract_definitions(self, context: str) -> str:
        if not context.strip():
            return "No key terms found."
        return self._call(DEFINITIONS_PROMPT.format(context=context), max_tokens=1200)

    def create_reading_card(self, context: str, mode: str = "general") -> str:
        if not context.strip():
            return "No document content available."
        persona = LENS_PERSONAS.get(mode, LENS_PERSONAS["general"])
        return self._call(
            READING_CARD_PROMPT.format(persona=persona, context=context),
            max_tokens=1200,
        )

    def summarise_document(self, context: str, mode: str = "general") -> str:
        if not context.strip():
            return "No document content available."
        persona = LENS_PERSONAS.get(mode, LENS_PERSONAS["general"])
        return self._call(
            OVERVIEW_PROMPT.format(persona=persona, context=context),
            max_tokens=1200
        )

    def create_literature_notes(self, context: str) -> str:
        if not context.strip():
            return "No document content available."
        return self._call(LITERATURE_NOTES_PROMPT.format(context=context), max_tokens=1200)

    def multi_document_answer(self, query: str,
                               doc_contexts: List[Dict],
                               mode: str = "general") -> str:
        persona = LENS_PERSONAS.get(mode, LENS_PERSONAS["general"])
        doc_sections = ""
        per_doc_template = ""
        for i, doc in enumerate(doc_contexts, 1):
            filename = doc.get("filename", f"Document {i}")
            summary = doc.get("summary", "")
            ctx = doc.get("context_text", doc.get("context", ""))
            doc_sections += f"\n--- DOCUMENT {i}: {filename} ---\n"
            if summary:
                doc_sections += f"[Summary: {summary}]\n\n"
            doc_sections += ctx[:2500] + "\n"
            per_doc_template += f"\n*{filename}:*\n[Key points from this document]\n"

        return self._call(
            MULTI_DOC_PROMPT.format(
                persona=persona,
                doc_count=len(doc_contexts),
                doc_sections=doc_sections,
                query=query,
                per_doc_template=per_doc_template,
            ),
            max_tokens=2500
        )

    def generate_doc_summary(self, text: str) -> str:
        """Lightweight summary for document routing."""
        try:
            return self._call(
                ROUTING_SUMMARY_PROMPT.format(text=text[:3000]),
                max_tokens=150,
                temperature=0.1
            )
        except Exception:
            return text[:200].strip()

    def answer_without_docs(self, query: str, mode: str = "general") -> str:
        persona = LENS_PERSONAS.get(mode, LENS_PERSONAS["general"])
        return self._call(
            NO_DOCS_PROMPT.format(persona=persona, query=query),
            max_tokens=600
        )

    # ── Convenience routing method for quick-action buttons ──
    def quick_action(self, action: str, context: str,
                     mode: str = "general") -> str:
        """
        Routes quick-action button clicks to the correct structured prompt.
        action: one of the QUICK_ACTIONS keys
        """
        actions = {
            "overview":      lambda: self.summarise_document(context, mode),
            "methodology":   lambda: self.extract_methodology(context),
            "findings":      lambda: self.extract_findings(context),
            "insights":      lambda: self.extract_insights(context),
            "limitations":   lambda: self.extract_limitations(context),
            "gap":           lambda: self.extract_research_gap(context),
            "definitions":   lambda: self.extract_definitions(context),
            "reading_card":  lambda: self.create_reading_card(context, mode),
            "literature_notes": lambda: self.create_literature_notes(context),
        }
        fn = actions.get(action)
        if fn:
            return fn()
        # Fallback — treat as a regular query
        return self.generate_answer(action, context, mode)

```


--- FILE: .\scripts\main.py ---
```
"""
DocIntel API — RAG++ v3.1
Per-user isolation + document routing + reranking + quick-action buttons.
With Supabase auth + upload limit enforcement.

Fixes applied:
  • /query and /quick now use Depends(get_current_user) — no more "anonymous" bucket
  • doc.get("text") replaces doc.get("full_text") — correct DocumentLoader key
  • config values wired into all engine constructors
  • get_uid() removed; dead code cleaned up
"""

import os, sys, json, logging, shutil, traceback, threading, uuid, time
import numpy as np
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).parent))
import config

from auth import get_current_user
from storage_manager import delete_user_documents, sync_user_documents, upload_document
from upload_limits import check_upload_limit, get_upload_usage, log_upload_sync

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def parse_allowed_origins() -> List[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", "").strip()
    if not raw:
        logger.warning("ALLOWED_ORIGINS not set; falling back to permissive CORS for now.")
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(title="Wink API", version="3.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ────────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 8
    mode: Optional[str] = "general"
    focus_document: Optional[str] = None

class QuickActionRequest(BaseModel):
    action: str   # overview|reading_card|methodology|findings|insights|limitations|gap|definitions|literature_notes|compare
    mode: Optional[str] = "general"
    top_k: Optional[int] = 12
    focus_document: Optional[str] = None

class QueryResponse(BaseModel):
    query: str
    answer: str
    chunks_retrieved: int
    chunks_in_context: int
    documents_used: List[str] = []
    mode: Optional[str] = "general"
    source: Optional[str] = None
    documents_searched: Optional[int] = 0
    action: Optional[str] = None

class UploadResponse(BaseModel):
    message: str
    files_uploaded: int
    chunks_created: int
    documents_indexed: int
    filenames: List[str]

class StatusResponse(BaseModel):
    status: str
    vectors_in_store: int
    documents_indexed: int
    version: str = "3.1.0"


class UploadUsageResponse(BaseModel):
    used: int
    limit: int
    remaining: int


class UploadJobCreateResponse(BaseModel):
    job_id: str
    status: str
    stage: str
    progress: int
    message: str
    filenames: List[str]


class UploadJobStatusResponse(BaseModel):
    job_id: str
    status: str
    stage: str
    progress: int
    message: str
    filenames: List[str] = []
    files_uploaded: int = 0
    chunks_created: int = 0
    documents_indexed: int = 0
    error: Optional[str] = None
    failure_stage: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    durations: Dict[str, float] = Field(default_factory=dict)

# ── Per-user paths ────────────────────────────────────────────────────────────

BASE = Path(__file__).parent.parent
ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".txt", ".csv", ".xlsx",
    ".pptx", ".html", ".epub", ".rtf", ".md",
}

def udata(uid):
    p = BASE / "user_data" / uid / "data"
    p.mkdir(parents=True, exist_ok=True)
    return p

def ustore(uid):
    p = BASE / "user_data" / uid / "vector_store"
    p.mkdir(parents=True, exist_ok=True)
    return p

def ureg(uid):
    return ustore(uid) / "document_registry.json"


def ujobs(uid):
    p = BASE / "user_data" / uid / "jobs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def ujob(uid, job_id):
    return ujobs(uid) / f"{job_id}.json"

def load_reg(uid):
    p = ureg(uid)
    return json.load(open(p)) if p.exists() else {}

def save_reg(uid, reg):
    with open(ureg(uid), "w") as f:
        json.dump(reg, f, indent=2)

# ── Shared embedder (loaded once) ─────────────────────────────────────────────

_embedder = None

def get_embedder():
    global _embedder
    if _embedder is None:
        from embedding_engine import EmbeddingEngine
        _embedder = EmbeddingEngine(
            model_name=config.EMBEDDING_MODEL,
            batch_size=config.EMBEDDING_BATCH_SIZE,
        )
    return _embedder

# ── Per-user engine cache ─────────────────────────────────────────────────────

_engines = {}
_job_lock = threading.Lock()
_upload_jobs: Dict[str, Dict[str, Any]] = {}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_job_from_disk(uid: str, job_id: str) -> Optional[Dict[str, Any]]:
    path = ujob(uid, job_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_job_to_disk(uid: str, job: Dict[str, Any]) -> None:
    with open(ujob(uid, job["job_id"]), "w", encoding="utf-8") as f:
        json.dump(job, f, indent=2)


def get_job(uid: str, job_id: str) -> Optional[Dict[str, Any]]:
    with _job_lock:
        job = _upload_jobs.get(job_id)
        if job and job.get("uid") == uid:
            return dict(job)
    disk_job = load_job_from_disk(uid, job_id)
    if disk_job:
        with _job_lock:
            _upload_jobs[job_id] = disk_job
        return dict(disk_job)
    return None


def save_job(uid: str, job: Dict[str, Any]) -> Dict[str, Any]:
    with _job_lock:
        _upload_jobs[job["job_id"]] = dict(job)
    save_job_to_disk(uid, job)
    return job


def create_job(uid: str, filenames: List[str]) -> Dict[str, Any]:
    job = {
        "job_id": uuid.uuid4().hex,
        "uid": uid,
        "status": "queued",
        "stage": "queued",
        "progress": 5,
        "message": "Upload received. Preparing indexing job...",
        "filenames": filenames,
        "files_uploaded": 0,
        "chunks_created": 0,
        "documents_indexed": 0,
        "error": None,
        "failure_stage": None,
        "started_at": iso_now(),
        "finished_at": None,
        "durations": {},
    }
    return save_job(uid, job)


def update_job(uid: str, job_id: str, **updates) -> Dict[str, Any]:
    current = get_job(uid, job_id)
    if not current:
        raise KeyError(f"Upload job '{job_id}' not found")
    current.update(updates)
    return save_job(uid, current)


def note_stage_duration(uid: str, job_id: str, stage: str, seconds: float) -> None:
    job = get_job(uid, job_id)
    if not job:
        return
    durations = dict(job.get("durations") or {})
    durations[stage] = round(seconds, 3)
    update_job(uid, job_id, durations=durations)


def user_has_active_job(uid: str) -> bool:
    with _job_lock:
        return any(
            job.get("uid") == uid and job.get("status") in {"queued", "running"}
            for job in _upload_jobs.values()
        )

def get_engines(uid: str) -> dict:
    if uid in _engines:
        return _engines[uid]

    from document_loader import DocumentLoader
    from chunking_engine import ChunkingEngine
    from vector_store_manager import VectorStoreManager
    from retriever import Retriever
    from context_builder import ContextBuilder
    from generation_engine import GenerationEngine

    embedder = get_embedder()
    data_dir = udata(uid)
    synced_files = sync_user_documents(uid, data_dir)
    store_dir = ustore(uid)

    vsm = VectorStoreManager(
        embedding_dim=embedder.embedding_dim,
        index_type="cosine",
        index_path=store_dir / "index.faiss",
        metadata_path=store_dir / "metadata.json",
    )

    retriever = Retriever(
        vsm=vsm,
        embedder=embedder,
        reranker_model=config.RERANKER_MODEL,
        top_docs=config.TOP_DOCS,
        chunks_per_doc=config.CHUNKS_PER_DOC,
        final_top_k=config.FINAL_TOP_K,
        use_reranker=config.USE_RERANKER,
    )

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not found")

    e = {
        "loader":    DocumentLoader(),
        # FIX: pass config values so MIN_CHUNK_SIZE=200 and MAX_CHUNK_SIZE=800
        # are honoured instead of the engine's internal defaults (500/800).
        "chunker":   ChunkingEngine(
            min_chunk_size=config.MIN_CHUNK_SIZE,
            max_chunk_size=config.MAX_CHUNK_SIZE,
            overlap_ratio=0.10,
        ),
        "embedder":  embedder,
        "vsm":       vsm,
        "retriever": retriever,
        # FIX: use config.MAX_CONTEXT_CHARS
        "builder":   ContextBuilder(max_context_chars=config.MAX_CONTEXT_CHARS),
        # FIX: use config model name and token limit
        "generator": GenerationEngine(
            api_key=api_key,
            model_name=config.GROQ_MODEL,
        ),
    }

    reg = load_reg(uid)
    index_path = store_dir / "index.faiss"
    metadata_path = store_dir / "metadata.json"
    has_local_docs = any(path.is_file() for path in data_dir.iterdir())

    if not has_local_docs:
        if reg or index_path.exists() or metadata_path.exists():
            logger.info("User %s: no synced documents found, clearing stale local state", uid[:8])
            for path in (index_path, metadata_path, ureg(uid)):
                path.unlink(missing_ok=True)
            reg = {}
    elif index_path.exists() and metadata_path.exists() and reg:
        if vsm.load():
            _restore_retriever(retriever, reg, embedder)
            logger.info(
                f"User {uid[:8]}: restored {vsm.index.ntotal} vectors, {len(reg)} docs"
            )
        else:
            logger.info("User %s: existing index could not be loaded, rebuilding", uid[:8])
            reg, chunk_count = rebuild_user_index(uid, e)
            logger.info(
                "User %s: rebuilt index with %s vectors across %s documents",
                uid[:8],
                chunk_count,
                len(reg),
            )
    elif has_local_docs:
        logger.info(
            "User %s: rebuilding local index from %s synced document(s)",
            uid[:8],
            len(synced_files),
        )
        reg, chunk_count = rebuild_user_index(uid, e)
        logger.info(
            "User %s: rebuilt index with %s vectors across %s documents",
            uid[:8],
            chunk_count,
            len(reg),
        )

    _engines[uid] = e
    return e


def _restore_retriever(retriever, reg, embedder):
    for doc_id, info in reg.items():
        summary = info.get("summary", "")
        if summary:
            emb = embedder.embed_document(summary)
            retriever.doc_embeddings[doc_id] = emb
            retriever.doc_metadata[doc_id] = {
                "filename":     info.get("filename", doc_id),
                "summary":      summary,
                "chunk_indices": info.get("chunk_indices", []),
                "chunk_count":  info.get("chunk_count", 0),
            }


def reset_user(uid):
    e = _engines.get(uid)
    if e:
        vsm = e["vsm"]
        vsm.index = vsm._create_index()
        vsm.metadata = {}
        vsm.vector_count = 0
        e["retriever"].clear_documents()
    _engines.pop(uid, None)
    with _job_lock:
        for job_id, job in list(_upload_jobs.items()):
            if job.get("uid") == uid:
                _upload_jobs.pop(job_id, None)


def upload_file_size(upload: UploadFile) -> int:
    current = upload.file.tell()
    upload.file.seek(0, os.SEEK_END)
    size = upload.file.tell()
    upload.file.seek(current)
    return size


def prepare_indexed_documents(
    e: dict,
    docs: List[dict],
    start_index: int,
    progress_callback=None,
) -> Tuple[List[dict], List[dict]]:
    indexed_docs = []
    all_chunks = []
    next_index = start_index

    total_docs = len(docs)
    for position, doc in enumerate(docs, start=1):
        chunks = e["chunker"].chunk_document(doc)
        if not chunks:
            continue

        doc_id = doc.get("doc_id", doc.get("filename", f"doc_{next_index}"))
        filename = doc.get("filename", doc_id)
        full_text = doc.get("text", "") or " ".join(
            chunk.get("text", "") for chunk in chunks[:10]
        )
        if progress_callback:
            progress_callback(
                stage="summarizing",
                current=position,
                total=total_docs,
                filename=filename,
                message=f"Creating routing summary for {filename}",
            )
        summary = e["generator"].generate_doc_summary(full_text)
        chunk_indices = list(range(next_index, next_index + len(chunks)))

        indexed_docs.append({
            "doc_id": doc_id,
            "filename": filename,
            "summary": summary,
            "chunk_count": len(chunks),
            "chunk_start": next_index,
            "chunk_end": next_index + len(chunks),
            "chunk_indices": chunk_indices,
            "chunks": chunks,
        })
        all_chunks.extend(chunks)
        next_index += len(chunks)

    return indexed_docs, all_chunks


def save_embeddings_in_batches(embedder, vsm, chunks: List[dict], progress_callback=None) -> None:
    total_chunks = len(chunks)
    for start in range(0, total_chunks, config.EMBEDDING_BATCH_SIZE):
        batch = chunks[start:start + config.EMBEDDING_BATCH_SIZE]
        texts = [chunk.get("text", "") for chunk in batch]
        if progress_callback:
            progress_callback(
                current=min(start + len(batch), total_chunks),
                total=total_chunks,
                message=f"Indexing passages {start + 1}-{start + len(batch)} of {total_chunks}",
            )
        embeddings = embedder.embed_texts(texts, normalize=True)
        vsm.add_embeddings(np.asarray(embeddings, dtype=np.float32), batch)


def register_documents(retriever, indexed_docs: List[dict]) -> None:
    for info in indexed_docs:
        routing_text = info["summary"] + " " + " ".join(
            chunk.get("text", "") for chunk in info["chunks"][:5]
        )
        retriever.register_document(
            doc_id=info["doc_id"],
            filename=info["filename"],
            summary=info["summary"],
            full_text=routing_text,
            chunk_indices=info["chunk_indices"],
        )


def rebuild_user_index(uid: str, e: dict, progress_callback=None) -> Tuple[dict, int]:
    docs = e["loader"].load_directory(str(udata(uid)))
    if not docs:
        raise HTTPException(400, "No documents could be loaded.")

    indexed_docs, all_chunks = prepare_indexed_documents(
        e,
        docs,
        start_index=0,
        progress_callback=progress_callback,
    )
    if not indexed_docs or not all_chunks:
        raise HTTPException(400, "No text could be extracted.")

    vsm = e["vsm"]
    vsm.index = vsm._create_index()
    vsm.metadata = {}
    vsm.vector_count = 0
    e["retriever"].clear_documents()

    save_embeddings_in_batches(
        e["embedder"],
        vsm,
        all_chunks,
        progress_callback=progress_callback,
    )
    vsm.save()
    register_documents(e["retriever"], indexed_docs)

    reg = {
        info["doc_id"]: {
            "filename": info["filename"],
            "summary": info["summary"],
            "chunk_count": info["chunk_count"],
            "chunk_start": info["chunk_start"],
            "chunk_end": info["chunk_end"],
            "chunk_indices": info["chunk_indices"],
        }
        for info in indexed_docs
    }
    save_reg(uid, reg)
    return reg, len(all_chunks)


def run_upload_job(uid: str, job_id: str, filenames: List[str], requires_rebuild: bool) -> None:
    started = time.perf_counter()
    current_stage = "starting"

    def transition(stage: str, progress: int, message: str) -> None:
        nonlocal current_stage
        current_stage = stage
        update_job(
            uid,
            job_id,
            status="running",
            stage=stage,
            progress=progress,
            message=message,
            failure_stage=None,
        )
        logger.info("Upload job %s user=%s stage=%s progress=%s", job_id[:8], uid[:8], stage, progress)

    def timed(stage: str, fn, *args, **kwargs):
        stage_start = time.perf_counter()
        result = fn(*args, **kwargs)
        note_stage_duration(uid, job_id, stage, time.perf_counter() - stage_start)
        return result

    try:
        transition("initializing", 10, "Preparing document engines...")
        e = timed("initializing", get_engines, uid)
        data_dir = udata(uid)
        reg = load_reg(uid)
        saved_paths = [data_dir / name for name in filenames]

        def progress_callback(stage: str = "indexing", current: int = 0, total: int = 0,
                              filename: str = "", message: str = ""):
            if stage == "summarizing":
                total = max(total, 1)
                progress = 35 + int((current / total) * 20)
                transition(stage, progress, message or f"Creating summaries for {filename}")
            else:
                total = max(total, 1)
                progress = 60 + int((current / total) * 25)
                transition(stage, progress, message or "Indexing passages...")

        if requires_rebuild or not reg or e["vsm"].index is None or e["vsm"].index.ntotal == 0:
            transition("rebuilding", 20, "Rebuilding the document index...")
            final_reg, chunk_count = timed(
                "rebuilding",
                rebuild_user_index,
                uid,
                e,
                progress_callback,
            )
            indexed_count = len(final_reg)
            action_word = "Reindexed"
        else:
            transition("extracting", 25, "Extracting text from new documents...")
            docs = []
            extract_start = time.perf_counter()
            for position, path in enumerate(saved_paths, start=1):
                transition(
                    "extracting",
                    25 + int((position / max(len(saved_paths), 1)) * 10),
                    f"Extracting text from {path.name}",
                )
                doc = e["loader"].load_document(str(path))
                if not doc:
                    raise HTTPException(400, f"No text could be extracted from '{path.name}'.")
                docs.append(doc)
            note_stage_duration(uid, job_id, "extracting", time.perf_counter() - extract_start)

            indexed_docs, all_chunks = timed(
                "summarizing",
                prepare_indexed_documents,
                e,
                docs,
                e["vsm"].vector_count,
                progress_callback,
            )
            if not indexed_docs or not all_chunks:
                raise HTTPException(400, "No text could be extracted.")

            vsm = e["vsm"]
            timed(
                "indexing",
                save_embeddings_in_batches,
                e["embedder"],
                vsm,
                all_chunks,
                progress_callback,
            )

            transition("finalizing", 92, "Saving vector store and finalizing document registry...")
            finalizing_start = time.perf_counter()
            vsm.save()
            register_documents(e["retriever"], indexed_docs)

            for info in indexed_docs:
                reg[info["doc_id"]] = {
                    "filename": info["filename"],
                    "summary": info["summary"],
                    "chunk_count": info["chunk_count"],
                    "chunk_start": info["chunk_start"],
                    "chunk_end": info["chunk_end"],
                    "chunk_indices": info["chunk_indices"],
                }

            save_reg(uid, reg)
            note_stage_duration(uid, job_id, "finalizing", time.perf_counter() - finalizing_start)
            final_reg = reg
            chunk_count = len(all_chunks)
            indexed_count = len(final_reg)
            action_word = "Indexed"

        transition("logging", 97, "Recording upload usage...")
        logging_start = time.perf_counter()
        for filename in filenames:
            file_path = data_dir / filename
            log_upload_sync(uid, filename, file_path.stat().st_size)
        note_stage_duration(uid, job_id, "logging", time.perf_counter() - logging_start)

        total_seconds = time.perf_counter() - started
        note_stage_duration(uid, job_id, "total", total_seconds)
        update_job(
            uid,
            job_id,
            status="completed",
            stage="completed",
            progress=100,
            message=f"{action_word} {len(filenames)} document(s). {chunk_count} passages are ready.",
            files_uploaded=len(filenames),
            chunks_created=chunk_count,
            documents_indexed=indexed_count,
            finished_at=iso_now(),
        )
        logger.info(
            "Upload job %s user=%s completed files=%s chunks=%s docs=%s total=%.2fs",
            job_id[:8],
            uid[:8],
            len(filenames),
            chunk_count,
            indexed_count,
            total_seconds,
        )
    except HTTPException as ex:
        total_seconds = time.perf_counter() - started
        note_stage_duration(uid, job_id, "total", total_seconds)
        update_job(
            uid,
            job_id,
            status="failed",
            stage="failed",
            progress=100,
            message=str(ex.detail),
            error=str(ex.detail),
            failure_stage=current_stage,
            finished_at=iso_now(),
        )
        logger.error(
            "Upload job %s user=%s failed stage=%s detail=%s",
            job_id[:8],
            uid[:8],
            current_stage,
            ex.detail,
        )
    except Exception as ex:
        total_seconds = time.perf_counter() - started
        note_stage_duration(uid, job_id, "total", total_seconds)
        detail = str(ex)
        update_job(
            uid,
            job_id,
            status="failed",
            stage="failed",
            progress=100,
            message=detail,
            error=detail,
            failure_stage=current_stage,
            finished_at=iso_now(),
        )
        logger.error("Upload job %s user=%s failed\n%s", job_id[:8], uid[:8], traceback.format_exc())

# ── Intent detection ──────────────────────────────────────────────────────────

def is_overview(q):
    return any(p in q.lower() for p in [
        "what is this", "what is this about", "summarise", "summarize",
        "overview", "what does this document", "give me a summary",
        "what topics", "what is covered",
    ])

def is_multi_doc(q, reg):
    if len(reg) < 2:
        return False
    return any(p in q.lower() for p in [
        "compare", "comparison", "differences", "similarities",
        "across documents", "all documents", "these documents",
        "contrast", "each document", "synthesize", "between the",
    ])

def is_extraction(q):
    return any(p in q.lower() for p in [
        "methodology", "methods", "sample size", "participants",
        "findings", "results", "limitations", "research question",
        "hypothesis", "data collection", "extract", "theoretical framework",
        "how many participants", "research design",
    ])


def filter_chunks_by_document(chunks: List[dict], focus_document: Optional[str]) -> List[dict]:
    if not focus_document:
        return chunks
    focus = Path(focus_document).name.lower().strip()
    filtered = []
    for chunk in chunks:
        doc_name = (
            chunk.get("_doc_filename")
            or chunk.get("doc_id")
            or chunk.get("metadata", {}).get("filename")
            or ""
        )
        if Path(str(doc_name)).name.lower().strip() == focus:
            filtered.append(chunk)
    return filtered

# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    logger.info("Wink RAG++ v3.1 ready.")

# ── Health (fast, no auth) ────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/upload-usage", response_model=UploadUsageResponse)
async def upload_usage(user_id: str = Depends(get_current_user)):
    try:
        usage = await get_upload_usage(user_id)
        return UploadUsageResponse(**usage)
    except Exception as ex:
        raise HTTPException(500, str(ex))


@app.get("/upload-jobs/{job_id}", response_model=UploadJobStatusResponse)
def upload_job_status(job_id: str, user_id: str = Depends(get_current_user)):
    job = get_job(user_id, job_id)
    if not job:
        raise HTTPException(404, "Upload job not found.")

    payload = {k: v for k, v in job.items() if k != "uid"}
    return UploadJobStatusResponse(**payload)

# ── Root status (JWT required) ────────────────────────────────────────────────

@app.get("/")
def root(user_id: str = Depends(get_current_user)):
    uid = user_id
    try:
        e = get_engines(uid)
        vc = e["vsm"].index.ntotal if e["vsm"].index else 0
        reg = load_reg(uid)
    except Exception:
        vc = 0
        reg = {}
    return StatusResponse(status="running", vectors_in_store=vc, documents_indexed=len(reg))

# ── Upload (JWT required) ─────────────────────────────────────────────────────

@app.post("/upload", response_model=UploadJobCreateResponse)
async def upload(
    files: List[UploadFile] = File(...),
    user_id: str = Depends(get_current_user),
):
    uid = user_id
    logger.info(f"Upload user={uid[:8]} files={[f.filename for f in files]}")

    try:
        data_dir = udata(uid)
        saved = []
        validated_files = []
        seen_names = set()
        requires_rebuild = False
        reg = load_reg(uid)

        if user_has_active_job(uid):
            raise HTTPException(409, "Another upload is still processing. Wait for it to finish first.")

        for file in files:
            ext = Path(file.filename).suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                raise HTTPException(400, f"File type '{ext}' not supported.")
            if file.filename in seen_names:
                raise HTTPException(400, f"Duplicate filename '{file.filename}' in one upload.")
            seen_names.add(file.filename)

            size = upload_file_size(file)
            if size > config.MAX_UPLOAD_FILE_SIZE_BYTES:
                raise HTTPException(
                    400,
                    f"'{file.filename}' exceeds the {config.MAX_UPLOAD_FILE_SIZE_MB} MB upload limit.",
                )

            validated_files.append(file)

        if not await check_upload_limit(uid, len(validated_files)):
            raise HTTPException(403, "Daily upload limit reached. Upgrade to Pro for unlimited.")

        for file in validated_files:
            dest = data_dir / file.filename
            if dest.exists():
                requires_rebuild = True
            file.file.seek(0)
            with open(dest, "wb") as f:
                shutil.copyfileobj(file.file, f)
            try:
                upload_document(uid, dest)
            except Exception as storage_ex:
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    500,
                    f"Failed to persist '{file.filename}' to storage: {storage_ex}",
                ) from storage_ex
            saved.append(file.filename)

        job = create_job(uid, saved)
        threading.Thread(
            target=run_upload_job,
            args=(uid, job["job_id"], saved, requires_rebuild or not reg),
            daemon=True,
        ).start()

        return UploadJobCreateResponse(
            job_id=job["job_id"],
            status=job["status"],
            stage=job["stage"],
            progress=job["progress"],
            message=job["message"],
            filenames=saved,
        )

    except HTTPException:
        raise
    except Exception as ex:
        logger.error(traceback.format_exc())
        raise HTTPException(500, f"{ex}\n{traceback.format_exc()}")

# ── Reset (JWT required) ──────────────────────────────────────────────────────

@app.delete("/reset")
def reset(user_id: str = Depends(get_current_user)):
    uid = user_id
    try:
        reset_user(uid)
        delete_user_documents(uid)
        for f in ujobs(uid).glob("*.json"):
            f.unlink()
        for f in udata(uid).iterdir():
            if f.is_file():
                f.unlink()
        for f in ustore(uid).glob("*"):
            f.unlink()
        return {"message": "Cleared."}
    except Exception as ex:
        raise HTTPException(500, str(ex))

# ── Documents list (JWT required) ─────────────────────────────────────────────

@app.get("/documents")
def list_docs(user_id: str = Depends(get_current_user)):
    uid = user_id
    try:
        data_dir = udata(uid)
        sync_user_documents(uid, data_dir)
        reg = load_reg(uid)
        files = []
        for f in data_dir.iterdir():
            if f.is_file() and not f.name.startswith('.'):
                summary = next(
                    (v.get("summary", "")[:80]
                     for v in reg.values() if v.get("filename") == f.name),
                    ""
                )
                files.append({
                    "filename":   f.name,
                    "size_bytes": f.stat().st_size,
                    "extension":  f.suffix.lower(),
                    "indexed":    any(v.get("filename") == f.name for v in reg.values()),
                    "summary":    summary,
                })
        return {"documents": files, "count": len(files), "indexed_count": len(reg)}
    except Exception as ex:
        raise HTTPException(500, str(ex))

# ── Quick actions (JWT required) ──────────────────────────────────────────────
# FIX: was using X-User-ID header → always resolved to "anonymous".
# Now uses the same JWT dependency as every other protected endpoint.

@app.post("/quick", response_model=QueryResponse)
def quick_action(
    request: QuickActionRequest,
    user_id: str = Depends(get_current_user),
):
    uid = user_id
    action = request.action.lower().strip()
    request_id = uuid.uuid4().hex[:8]
    started = time.perf_counter()
    logger.info("Quick action request=%s user=%s action=%s mode=%s", request_id, uid[:8], action, request.mode or "general")

    try:
        e = get_engines(uid)
        vsm = e["vsm"]
        reg = load_reg(uid)
        generator = e["generator"]
        retriever = e["retriever"]
        builder = e["builder"]
        mode = request.mode or "general"

        ACTION_QUERIES = {
            "overview":    "document overview summary main topics purpose",
            "reading_card": "structured reading card key takeaways purpose limitations use case",
            "methodology": "research methodology methods sample data collection analysis",
            "findings":    "key findings results conclusions evidence data",
            "insights":    "key insights important points main contributions implications",
            "limitations": "limitations constraints weaknesses study design generalizability",
            "gap":         "research gap literature review future research unanswered questions",
            "definitions": "key terms definitions concepts theoretical framework vocabulary",
            "literature_notes": "literature review notes contribution prior work use in a review",
            "compare":     "compare documents similarities differences contrast",
        }

        if vsm.index is None or vsm.index.ntotal == 0:
            return QueryResponse(
                query=action, mode=mode, action=action,
                answer="No documents uploaded yet. Please upload a document first.",
                chunks_retrieved=0, chunks_in_context=0,
                documents_searched=0,
            )

        if action == "compare":
            if len(reg) < 2:
                return QueryResponse(
                    query="compare", mode=mode, action=action,
                    answer=(
                        "**Compare Documents**\n\n"
                        "Please upload at least 2 documents to use document comparison.\n\n"
                        "You currently have "
                        f"{len(reg)} document{'s' if len(reg) != 1 else ''} uploaded."
                    ),
                    chunks_retrieved=0, chunks_in_context=0,
                    documents_searched=len(reg),
                )

            per_doc = retriever.retrieve_per_document(
                "compare documents similarities differences", top_k_per_doc=4
            )
            ctx = builder.build_multi_doc_context(per_doc, retriever.doc_metadata)

            doc_ctxs = [
                {
                    "doc_id":       doc["doc_id"],
                    "filename":     doc["filename"],
                    "summary":      doc["summary"],
                    "context_text": doc.get("context_text", ""),
                }
                for doc in ctx["documents"]
            ]

            answer = generator.multi_document_answer(
                "Compare these documents. Identify similarities, differences, and contradictions.",
                doc_ctxs, mode=mode,
            )
            names = [d["filename"] for d in ctx["documents"]]
            response = QueryResponse(
                query="Compare Documents", mode=mode, action=action,
                answer=answer,
                chunks_retrieved=len(ctx["chunks"]),
                chunks_in_context=len(ctx["chunks"]),
                documents_used=names,
                source=f"Multi-document: {', '.join(names)}",
                documents_searched=len(reg),
            )
            logger.info(
                "Quick action request=%s user=%s completed action=%s docs=%s chunks=%s duration=%.2fs",
                request_id, uid[:8], action, len(names), len(ctx["chunks"]), time.perf_counter() - started
            )
            return response

        query_str = ACTION_QUERIES.get(action, action)
        top_k = request.top_k or 12

        chunks = retriever.retrieve(query_str, top_k=top_k)
        chunks = filter_chunks_by_document(chunks, request.focus_document)
        if not chunks:
            # Fallback: grab first chunks from each document
            chunks = []
            for doc_id, info in reg.items():
                if request.focus_document and Path(info.get("filename", "")).name.lower() != Path(request.focus_document).name.lower():
                    continue
                indices = info.get("chunk_indices", [])[:5]
                for idx in indices:
                    m = vsm.metadata.get(idx)
                    if m:
                        chunks.append(dict(m))

        ctx = builder.build_context(chunks, query_str)
        context = ctx["context"]

        answer = generator.quick_action(action, context, mode)
        docs_used = list({
            c.get("_doc_filename", "")
            for c in chunks if c.get("_doc_filename")
        })

        response = QueryResponse(
            query=action.replace("_", " ").title(),
            mode=mode,
            action=action,
            answer=answer,
            chunks_retrieved=len(chunks),
            chunks_in_context=len(ctx["chunks"]),
            documents_used=docs_used,
            source=", ".join(docs_used) if docs_used else "",
            documents_searched=len(reg),
        )
        logger.info(
            "Quick action request=%s user=%s completed action=%s docs=%s chunks=%s duration=%.2fs",
            request_id, uid[:8], action, len(docs_used), len(ctx["chunks"]), time.perf_counter() - started
        )
        return response

    except HTTPException:
        raise
    except Exception as ex:
        logger.error(
            "Quick action request=%s user=%s failed action=%s duration=%.2fs\n%s",
            request_id,
            uid[:8],
            action,
            time.perf_counter() - started,
            traceback.format_exc(),
        )
        raise HTTPException(500, f"{ex}\n{traceback.format_exc()}")

# ── Query (JWT required) ──────────────────────────────────────────────────────
# FIX: was using X-User-ID header → always resolved to "anonymous".

@app.post("/query", response_model=QueryResponse)
def query(
    request: QueryRequest,
    user_id: str = Depends(get_current_user),
):
    uid = user_id
    request_id = uuid.uuid4().hex[:8]
    started = time.perf_counter()
    logger.info("Query request=%s user=%s mode=%s top_k=%s", request_id, uid[:8], request.mode or "general", request.top_k or 8)

    try:
        e = get_engines(uid)
        vsm = e["vsm"]
        reg = load_reg(uid)
        retriever = e["retriever"]
        builder = e["builder"]
        generator = e["generator"]
        mode = request.mode or "general"
        q = request.query

        if vsm.index is None or vsm.index.ntotal == 0:
            answer = generator.answer_without_docs(q, mode)
            return QueryResponse(
                query=q, answer=answer,
                chunks_retrieved=0, chunks_in_context=0,
                mode=mode,
                source="General knowledge (no documents uploaded)",
                documents_searched=0,
            )

        if is_multi_doc(q, reg):
            per_doc = retriever.retrieve_per_document(q, top_k_per_doc=4)
            ctx = builder.build_multi_doc_context(per_doc, retriever.doc_metadata, q)
            doc_ctxs = [
                {
                    "doc_id":       d["doc_id"],
                    "filename":     d["filename"],
                    "summary":      d["summary"],
                    "context_text": d.get("context_text", ""),
                }
                for d in ctx["documents"]
            ]
            answer = generator.multi_document_answer(q, doc_ctxs, mode)
            names = [d["filename"] for d in ctx["documents"]]
            response = QueryResponse(
                query=q, answer=answer,
                chunks_retrieved=len(ctx["chunks"]),
                chunks_in_context=len(ctx["chunks"]),
                documents_used=names, mode=mode,
                source=f"Multi-document: {', '.join(names)}",
                documents_searched=len(reg),
            )
            logger.info(
                "Query request=%s user=%s completed multi-doc docs=%s chunks=%s duration=%.2fs",
                request_id, uid[:8], len(names), len(ctx["chunks"]), time.perf_counter() - started
            )
            return response

        if is_overview(q):
            chunks = retriever.retrieve(q, top_k=12)
            chunks = filter_chunks_by_document(chunks, request.focus_document)
            ctx = builder.build_context(chunks, q)
            answer = generator.summarise_document(ctx["context"], mode)
            docs_used = list({
                c.get("_doc_filename", "") for c in chunks if c.get("_doc_filename")
            })
            response = QueryResponse(
                query=q, answer=answer,
                chunks_retrieved=len(chunks),
                chunks_in_context=len(ctx["chunks"]),
                documents_used=docs_used, mode=mode,
                source="Full document analysis",
                documents_searched=len(reg),
            )
            logger.info(
                "Query request=%s user=%s completed overview docs=%s chunks=%s duration=%.2fs",
                request_id, uid[:8], len(docs_used), len(ctx["chunks"]), time.perf_counter() - started
            )
            return response

        chunks = retriever.retrieve(q, top_k=request.top_k or 8)
        chunks = filter_chunks_by_document(chunks, request.focus_document)
        if not chunks:
            return QueryResponse(
                query=q, mode=mode,
                answer=(
                    "**Direct Answer**\nNo relevant content found for this query.\n\n"
                    "**Suggestion**\nTry rephrasing, or use a quick-action button above."
                ),
                chunks_retrieved=0, chunks_in_context=0,
                documents_searched=len(reg),
            )

        ctx = builder.build_context(chunks, q)
        answer = generator.generate_answer(q, ctx["context"], mode)
        docs_used = list({
            c.get("_doc_filename", "") for c in chunks if c.get("_doc_filename")
        })
        top = ctx["chunks"][0] if ctx["chunks"] else {}
        src = top.get("_doc_filename") or top.get("doc_id", "")
        meta = top.get("metadata", {})
        if meta.get("section") or meta.get("page"):
            src += f" | {meta.get('section', '')} | Page {meta.get('page', '')}"

        response = QueryResponse(
            query=q, answer=answer,
            chunks_retrieved=len(chunks),
            chunks_in_context=len(ctx["chunks"]),
            documents_used=docs_used, mode=mode,
            source=src,
            documents_searched=len(reg),
        )
        logger.info(
            "Query request=%s user=%s completed docs=%s chunks=%s duration=%.2fs",
            request_id, uid[:8], len(docs_used), len(ctx["chunks"]), time.perf_counter() - started
        )
        return response

    except HTTPException:
        raise
    except Exception as ex:
        logger.error(
            "Query request=%s user=%s failed duration=%.2fs\n%s",
            request_id,
            uid[:8],
            time.perf_counter() - started,
            traceback.format_exc(),
        )
        raise HTTPException(500, f"{ex}\n{traceback.format_exc()}")

```


--- FILE: .\scripts\retriever.py ---
```
"""
RAG++ Retriever — Document routing + per-doc chunk retrieval + cross-encoder reranking.
"""
import logging
import numpy as np
from typing import List, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    from sentence_transformers import CrossEncoder
    RERANKER_AVAILABLE = True
except ImportError:
    RERANKER_AVAILABLE = False

class Retriever:
    def __init__(self, vsm, embedder, reranker_model="BAAI/bge-reranker-base",
                 top_docs=5, chunks_per_doc=12, final_top_k=8, use_reranker=True):
        self.vsm = vsm
        self.embedder = embedder
        self.top_docs = top_docs
        self.chunks_per_doc = chunks_per_doc
        self.final_top_k = final_top_k
        self.use_reranker = use_reranker and RERANKER_AVAILABLE
        self._reranker = None
        self._reranker_model = reranker_model
        self.doc_embeddings: Dict[str, np.ndarray] = {}
        self.doc_metadata: Dict[str, dict] = {}

    def _get_reranker(self):
        if self._reranker is None and self.use_reranker:
            try:
                logger.info(f"Loading reranker: {self._reranker_model}")
                self._reranker = CrossEncoder(self._reranker_model, max_length=512)
            except Exception as e:
                logger.warning(f"Reranker load failed: {e}")
                self.use_reranker = False
        return self._reranker

    def register_document(self, doc_id, filename, summary, full_text, chunk_indices):
        routing_text = f"{summary}\n\n{full_text[:3000]}"
        self.doc_embeddings[doc_id] = self.embedder.embed_document(routing_text)
        self.doc_metadata[doc_id] = {
            "filename": filename, "summary": summary,
            "chunk_indices": chunk_indices, "chunk_count": len(chunk_indices),
        }

    def clear_documents(self):
        self.doc_embeddings = {}
        self.doc_metadata = {}

    def _route_to_documents(self, query_embedding, n):
        if not self.doc_embeddings:
            return []
        scores = {did: float(np.dot(query_embedding, emb))
                  for did, emb in self.doc_embeddings.items()}
        return [d for d, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)[:n]]

    def _get_doc_chunks(self, doc_id):
        indices = self.doc_metadata.get(doc_id, {}).get("chunk_indices", [])
        chunks = []
        for idx in indices:
            m = self.vsm.metadata.get(idx)
            if m:
                c = dict(m)
                c["_vsm_index"] = idx
                chunks.append(c)
        return chunks

    def _score_chunks(self, query_embedding, chunks):
        scored = []
        for chunk in chunks:
            emb = chunk.get("embedding")
            if emb is None:
                vsm_index = chunk.get("_vsm_index")
                if vsm_index is not None:
                    emb = self.vsm.get_embedding(vsm_index)
            if emb is not None:
                if isinstance(emb, list):
                    emb = np.array(emb, dtype=np.float32)
                scored.append((chunk, float(np.dot(query_embedding, emb))))
            else:
                scored.append((chunk, 0.0))
        return sorted(scored, key=lambda x: x[1], reverse=True)

    def _rerank(self, query, chunks, top_k):
        if not chunks:
            return []
        reranker = self._get_reranker()
        if reranker is None:
            return chunks[:top_k]
        try:
            pairs = [(query, c.get("text", "")) for c in chunks]
            scores = reranker.predict(pairs)
            ranked = sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)
            return [c for c, _ in ranked[:top_k]]
        except Exception as e:
            logger.warning(f"Reranking failed: {e}")
            return chunks[:top_k]

    def retrieve(self, query, top_k=None, force_doc_ids=None):
        if top_k is None:
            top_k = self.final_top_k
        if self.vsm.index is None or self.vsm.index.ntotal == 0:
            return []

        query_embedding = self.embedder.embed_query(query)

        if force_doc_ids:
            selected = force_doc_ids
        elif self.doc_embeddings:
            selected = self._route_to_documents(query_embedding, self.top_docs)
        else:
            return self._global_fallback(query_embedding, top_k)

        if not selected:
            return self._global_fallback(query_embedding, top_k)

        candidates = []
        for doc_id in selected:
            doc_chunks = self._get_doc_chunks(doc_id)
            if not doc_chunks:
                continue
            scored = self._score_chunks(query_embedding, doc_chunks)
            top_from_doc = [c for c, _ in scored[:self.chunks_per_doc]]
            meta = self.doc_metadata.get(doc_id, {})
            for chunk in top_from_doc:
                chunk["_doc_id"] = doc_id
                chunk["_doc_filename"] = meta.get("filename", doc_id)
                chunk["_doc_summary"] = meta.get("summary", "")
                candidates.append(chunk)

        if not candidates:
            return self._global_fallback(query_embedding, top_k)

        return self._rerank(query, candidates, top_k)

    def retrieve_per_document(self, query, top_k_per_doc=4):
        query_embedding = self.embedder.embed_query(query)
        result = {}
        for doc_id in self.doc_metadata:
            doc_chunks = self._get_doc_chunks(doc_id)
            if not doc_chunks:
                continue
            scored = self._score_chunks(query_embedding, doc_chunks)
            result[doc_id] = [c for c, _ in scored[:top_k_per_doc]]
        return result

    def _global_fallback(self, query_embedding, top_k):
        logger.info("Global fallback search")
        try:
            q = query_embedding.astype(np.float32).reshape(1, -1)
            n = min(top_k * 4, self.vsm.index.ntotal)
            distances, indices = self.vsm.index.search(q, n)
            chunks = []
            for idx in indices[0]:
                if idx < 0:
                    continue
                m = self.vsm.metadata.get(int(idx))
                if m:
                    chunks.append(dict(m))
            return self._rerank("", chunks, top_k)
        except Exception as e:
            logger.error(f"Global fallback failed: {e}")
            return []

```


--- FILE: .\scripts\storage_manager.py ---
```
import logging
import mimetypes
import os
from pathlib import Path
from typing import List

from supabase import Client, create_client

import config

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "wink-user-docs")

_storage_client: Client | None = None
_bucket_ready = False


def get_storage_client() -> Client:
    global _storage_client
    if _storage_client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        _storage_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _storage_client


def ensure_storage_bucket() -> None:
    global _bucket_ready
    if _bucket_ready:
        return

    client = get_storage_client()
    try:
        client.storage.get_bucket(SUPABASE_STORAGE_BUCKET)
    except Exception:
        logger.info("Creating storage bucket '%s'", SUPABASE_STORAGE_BUCKET)
        client.storage.create_bucket(
            SUPABASE_STORAGE_BUCKET,
            options={
                "public": False,
                "file_size_limit": config.MAX_UPLOAD_FILE_SIZE_BYTES,
            },
        )
    _bucket_ready = True


def storage_object_path(uid: str, filename: str) -> str:
    safe_name = Path(filename).name
    return f"{uid}/{safe_name}"


def upload_document(uid: str, local_path: Path) -> None:
    ensure_storage_bucket()
    client = get_storage_client()
    mime_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
    with open(local_path, "rb") as file_obj:
        client.storage.from_(SUPABASE_STORAGE_BUCKET).upload(
            path=storage_object_path(uid, local_path.name),
            file=file_obj,
            file_options={
                "cache-control": "3600",
                "upsert": "true",
                "content-type": mime_type,
            },
        )


def delete_documents(uid: str, filenames: List[str]) -> None:
    if not filenames:
        return

    ensure_storage_bucket()
    client = get_storage_client()
    paths = [storage_object_path(uid, name) for name in filenames]
    client.storage.from_(SUPABASE_STORAGE_BUCKET).remove(paths)


def list_user_documents(uid: str) -> List[dict]:
    ensure_storage_bucket()
    client = get_storage_client()
    result = client.storage.from_(SUPABASE_STORAGE_BUCKET).list(
        uid,
        {
            "limit": 1000,
            "offset": 0,
            "sortBy": {"column": "name", "order": "asc"},
        },
    )
    return result or []


def sync_user_documents(uid: str, target_dir: Path) -> List[Path]:
    target_dir.mkdir(parents=True, exist_ok=True)
    remote_files = list_user_documents(uid)
    remote_names = {item.get("name") for item in remote_files if item.get("name")}

    for local_file in target_dir.iterdir():
        if local_file.is_file() and local_file.name not in remote_names:
            local_file.unlink()

    synced = []
    client = get_storage_client()
    for item in remote_files:
        name = item.get("name")
        if not name:
            continue
        dest = target_dir / name
        if not dest.exists():
            payload = client.storage.from_(SUPABASE_STORAGE_BUCKET).download(
                storage_object_path(uid, name)
            )
            with open(dest, "wb") as file_obj:
                file_obj.write(payload)
        synced.append(dest)
    return synced


def delete_user_documents(uid: str) -> None:
    files = list_user_documents(uid)
    paths = [storage_object_path(uid, item["name"]) for item in files if item.get("name")]
    if not paths:
        return
    client = get_storage_client()
    client.storage.from_(SUPABASE_STORAGE_BUCKET).remove(paths)

```


--- FILE: .\scripts\upload_limits.py ---
```
import logging
import os
from datetime import datetime, timezone
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")  # Use service role key
if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

logger = logging.getLogger(__name__)

FREE_LIMIT = int(os.environ.get("FREE_UPLOAD_LIMIT", "4"))


async def get_upload_usage(user_id: str) -> dict:
    today = datetime.now(timezone.utc).date().isoformat()
    result = (
        supabase.table("uploads")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .gte("uploaded_at", f"{today}T00:00:00Z")
        .execute()
    )
    count = result.count or 0
    remaining = max(FREE_LIMIT - count, 0)
    return {
        "used": count,
        "limit": FREE_LIMIT,
        "remaining": remaining,
    }

async def check_upload_limit(user_id: str, num_files: int) -> bool:
    """Return True if allowed, else False."""
    usage = await get_upload_usage(user_id)
    return (usage["used"] + num_files) <= FREE_LIMIT

def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def log_upload_sync(user_id: str, filename: str, size: int) -> None:
    """Log an upload to Supabase using a UTC timestamp with a Z suffix."""
    ts = _utc_timestamp()
    supabase.table("uploads").insert({
        "user_id": user_id,
        "filename": filename,
        "file_size": size,
        "uploaded_at": ts,
    }).execute()


async def log_upload(user_id: str, filename: str, size: int):
    try:
        log_upload_sync(user_id, filename, size)
    except Exception as exc:
        logger.error("Failed to log upload for %s: %s", user_id[:8], exc)
        raise

```


--- FILE: .\scripts\vector_store_manager.py ---
```
"""
Vector store manager for storing and retrieving embeddings using FAISS.
Handles index creation, metadata storage, and persistence.
"""

import json
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import numpy as np

try:
    import faiss
except ImportError:
    faiss = None

logger = logging.getLogger(__name__)


class VectorStoreManager:
    """
    Manages FAISS vector index for similarity search.
    Stores embeddings and maintains metadata mapping.
    """
    
    def __init__(self, embedding_dim: int, index_type: str = "cosine",
                 index_path: Optional[Path] = None,
                 metadata_path: Optional[Path] = None):
        """
        Initialize the vector store manager.
        
        Args:
            embedding_dim: Dimension of embeddings
            index_type: Type of index ("cosine" or "l2")
            index_path: Path to save/load index
            metadata_path: Path to save/load metadata
        """
        if faiss is None:
            raise ImportError(
                "faiss not installed. Install with: pip install faiss-cpu"
            )
        
        self.embedding_dim = embedding_dim
        self.index_type = index_type
        self.index_path = Path(index_path) if index_path else None
        self.metadata_path = Path(metadata_path) if metadata_path else None
        
        # Create index
        self.index = self._create_index()
        self.metadata = {}  # Maps index position to chunk metadata
        self.vector_count = 0
    
    def _create_index(self) -> faiss.Index:
        """Create a new FAISS index."""
        if self.index_type == "cosine":
            # For cosine similarity, normalize embeddings and use L2
            index = faiss.IndexFlatL2(self.embedding_dim)
        elif self.index_type == "l2":
            index = faiss.IndexFlatL2(self.embedding_dim)
        else:
            raise ValueError(f"Unknown index type: {self.index_type}")
        
        logger.info(f"Created FAISS index: type={self.index_type}, dim={self.embedding_dim}")
        return index
    
    def add_embeddings(self, embeddings: np.ndarray, 
                      metadata_list: List[Dict]) -> None:
        """
        Add embeddings to the index.
        
        Args:
            embeddings: numpy array of shape (n, embedding_dim)
            metadata_list: List of metadata dicts for each embedding
        """
        if len(embeddings) != len(metadata_list):
            raise ValueError("Embeddings and metadata sizes don't match")
        
        # Normalize for cosine similarity if needed
        if self.index_type == "cosine":
            embeddings = self._normalize_embeddings(embeddings)
        
        # Ensure float32 type for FAISS
        embeddings = embeddings.astype(np.float32)
        
        # Add to index
        self.index.add(embeddings)
        
        # Store metadata
        for i, metadata in enumerate(metadata_list):
            clean_metadata = dict(metadata)
            clean_metadata.pop("embedding", None)
            self.metadata[self.vector_count + i] = clean_metadata
        
        self.vector_count += len(embeddings)
        logger.info(f"Added {len(embeddings)} embeddings. Total: {self.vector_count}")
    
    def search(self, query_embedding: np.ndarray, 
               top_k: int = 5) -> Tuple[np.ndarray, List[int], List[Dict]]:
        """
        Search for similar embeddings.
        
        Args:
            query_embedding: Query embedding (shape: embedding_dim)
            top_k: Number of results to return
            
        Returns:
            Tuple of (distances, indices, metadata_list)
        """
        # Normalize if needed
        if self.index_type == "cosine":
            query_embedding = self._normalize_embeddings(
                query_embedding.reshape(1, -1)
            )[0]
        
        # Ensure float32 type
        query_embedding = query_embedding.astype(np.float32).reshape(1, -1)
        
        # Search
        distances, indices = self.index.search(query_embedding, top_k)
        
        distances = distances[0]
        indices = indices[0].tolist()
        
        # Convert distances to similarities (for L2 distance)
        if self.index_type == "cosine":
            # For L2 on normalized vectors, distance = 2 - 2*similarity
            similarities = 1 - (distances / 2)
        else:
            similarities = distances
        
        # Retrieve metadata
        metadata_list = [self.metadata.get(idx, {}) for idx in indices]
        
        return similarities, indices, metadata_list
    
    def get_size(self) -> int:
        """Get number of vectors in the index."""
        return self.index.ntotal

    def get_embedding(self, index: int) -> Optional[np.ndarray]:
        """Reconstruct a vector directly from FAISS when metadata omits embeddings."""
        try:
            return np.array(self.index.reconstruct(index), dtype=np.float32)
        except Exception as e:
            logger.warning(f"Could not reconstruct embedding {index}: {e}")
            return None
    
    def save(self) -> None:
        """Save index and metadata to disk."""
        if not self.index_path or not self.metadata_path:
            logger.warning("Index and metadata paths not set. Skipping save.")
            return
        
        # Save index
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self.index, str(self.index_path))
        logger.info(f"Saved index to {self.index_path}")
        
        # Save metadata
        self.metadata_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.metadata_path, 'w') as f:
            # Convert numpy arrays in metadata to lists
            metadata_serializable = {}
            for key, value in self.metadata.items():
                metadata_serializable[str(key)] = self._make_serializable(value)
            
            json.dump(metadata_serializable, f, indent=2)
        logger.info(f"Saved metadata to {self.metadata_path}")
    
    def load(self) -> bool:
        """
        Load index and metadata from disk.
        
        Returns:
            True if successful, False otherwise
        """
        if not self.index_path or not self.metadata_path:
            logger.warning("Index and metadata paths not set. Skipping load.")
            return False
        
        try:
            # Load index
            if self.index_path.exists():
                self.index = faiss.read_index(str(self.index_path))
                logger.info(f"Loaded index from {self.index_path}")
            else:
                logger.warning(f"Index file not found: {self.index_path}")
                return False
            
            # Load metadata
            if self.metadata_path.exists():
                with open(self.metadata_path, 'r') as f:
                    metadata_serializable = json.load(f)
                
                # Convert string keys back to integers
                self.metadata = {
                    int(key): value for key, value in metadata_serializable.items()
                }
                logger.info(f"Loaded metadata from {self.metadata_path}")
            else:
                logger.warning(f"Metadata file not found: {self.metadata_path}")
                return False
            
            self.vector_count = self.index.ntotal
            logger.info(f"Vector store loaded: {self.vector_count} vectors")
            return True
        
        except Exception as e:
            logger.error(f"Error loading vector store: {str(e)}")
            return False
    
    @staticmethod
    def _normalize_embeddings(embeddings: np.ndarray) -> np.ndarray:
        """Normalize embeddings using L2 norm."""
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        return embeddings / (norms + 1e-10)
    
    @staticmethod
    def _make_serializable(obj):
        """Convert numpy arrays to lists for JSON serialization."""
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, dict):
            return {k: VectorStoreManager._make_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [VectorStoreManager._make_serializable(item) for item in obj]
        else:
            return obj

```


--- FILE: .\scripts\__init__.py ---
```
"""
Document Intelligence Retrieval Engine v2
A lightweight but high-quality retrieval layer for document intelligence systems.
"""

__version__ = "1.0.0"
__author__ = "Document Intelligence Team"

from .config import *
from .document_loader import DocumentLoader
from .chunking_engine import ChunkingEngine
from .embedding_engine import EmbeddingEngine
from .vector_store_manager import VectorStoreManager
from .retriever import Retriever
from .context_builder import ContextBuilder

__all__ = [
    "DocumentLoader",
    "ChunkingEngine",
    "EmbeddingEngine",
    "VectorStoreManager",
    "Retriever",
    "ContextBuilder",
]

```
