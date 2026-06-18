# DOC Medical Assistant Chartboard

DOC is a local-first prototype for a medical assistant and disease-detection style chartboard. It collects symptoms, visible findings, optional images/reports, allergies, current medicines, and extra notes, then generates a structured guidance report. It also includes a voice chat assistant and protected admin training mode.

> Safety scope: DOC is educational triage support, not a doctor, diagnosis engine, prescription system, or regulated medical device. Emergency symptoms need urgent local medical care.

## What Is Included

- Landing page with the temporary product name `DOC`.
- Manual intake flow for name, age, symptoms, visual observations, allergies, medicines, uploads, reports, and extra details.
- Voice/text chat assistant using browser speech recognition and speech synthesis where supported, with an optional local `faster-whisper` audio transcription fallback.
- Voice-first assistant page with continuous listening, animated speech wave, reply-time mic pause to prevent self-echo, and upload support.
- Python transcript parser for flexible voice answers such as one-word names, short ages, full sentences, or half sentences.
- Report generator with urgency flags, possible causes, restrictions, food/fluid guidance, medicine table, and medical-term explanations.
- Downloadable/printable report page.
- Typed follow-up assistant attached to generated reports.
- Admin-only training mode.
- Local training data processor with text extraction, tokenization, vectorization, duplicate detection, unsafe-claim rejection, and audit logging.
- Import script for the `sumeshverse/medical-ai-project` disease/symptom/description/precaution dataset.
- Tiny local disease classifier that runs forward propagation and backward propagation over local condition examples.
- Labeled vector upload support through `.data`, `.vec`, and `.vector` files.
- Trusted online research fallback through MedlinePlus/NLM health-topic search when local vector knowledge is weak.
- Separate trained-data views for manual/self-trained data and user-interaction learning data.
- Internet/offline awareness banner in the browser.
- No npm package dependencies for the current prototype.

## Run Locally

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Admin training login:

```text
username: admin
password: admin123
```

Run smoke tests:

```bash
npm test
```

Optional server-side voice transcription:

```bash
pip install -r requirements-voice.txt
```

The local Whisper fallback uses `src/voice/faster_whisper_transcribe.py`. By default it uses model `base`, language `en`, and device `auto`, which means CUDA is used when CTranslate2 can see a GPU and CPU is used otherwise. You can override it before starting the server:

```bash
set DOC_WHISPER_MODEL=base
set DOC_WHISPER_DEVICE=auto
set DOC_WHISPER_COMPUTE=
set DOC_WHISPER_LANGUAGE=en
```

`faster-whisper` only converts audio into text. DOC's actual assistant behavior comes from `src/voice/assistantLibrary.js` and `src/voice/voice_parser.py`: greetings, identity questions, slot prompts, medical intake extraction, and report commands are handled there.

After a faster-whisper model has been cached once, the adapter resolves the local Hugging Face snapshot directly so normal transcription can work without checking Hugging Face on every run. If `device=auto` sees a GPU but CUDA runtime files such as `cublas64_12.dll` are missing, DOC falls back to CPU and reports the fallback reason in the JSON response. Install the matching CUDA/cuBLAS/cuDNN runtime and keep those DLLs on `PATH` to use GPU inference.

Optional dataset import after cloning `sumeshverse/medical-ai-project` into `.codex-tmp/repos/medical-ai-project`:

```bash
npm run import:medical-dataset
```

## Project Flow

1. User opens the landing page.
2. User chooses either `Chat with AI Assistant` or `Get Started`.
3. Manual intake collects structured details:
   - name
   - age
   - sex
   - symptoms
   - visual observations
   - optional visual files
   - allergies and current medicines
   - optional medical reports
   - additional details
4. Voice assistant collects the same information through continuous speech and optional uploads.
5. Backend combines the input text and upload metadata.
6. The local retrieval engine searches trained knowledge vectors.
7. If local knowledge is weak and internet is available, DOC can query trusted MedlinePlus/NLM health-topic search, tokenize the accepted result, add it to local training data, and regenerate the report.
8. DOC generates a report and stores it locally.
9. User can print, save as PDF, download HTML, ask typed follow-ups, or submit feedback.
10. Feedback enters the user-learning bucket for review.

## Training Flow

Training mode is available from the three-line menu.

1. Admin logs in.
2. Admin uploads text, CSV, JSON, PDF, spreadsheet, document, or image files.
3. DOC detects the file type.
4. Readable text is extracted.
5. Text is checked for obvious unsafe false claims.
6. Text is tokenized.
7. A local vector is created from the tokens.
8. DOC compares the upload with existing training data.
9. Exact or near duplicates are ignored.
10. Related data with new terms is added as an extension.
11. Rejected uploads are logged in `data/training/audit-log.json`.

User feedback follows a separate path. It is stored as `pending_review` so random corrections do not immediately poison medical knowledge.

## Local AI Design

This prototype uses a local retrieval-plus-rules engine with a tiny trainable classifier:

- Tokenization: `src/training/vectorStore.js`
- Vectorization: normalized term-frequency vectors
- Similarity: cosine similarity
- Forward/backward propagation classifier: `src/training/neuralTrainer.js`
- Training ingestion: `src/training/fileProcessor.js`
- External dataset import: `scripts/importMedicalDataset.js`
- Report generation: `src/ai/medicalEngine.js`
- Chat state: `src/ai/chatAssistant.js`
- Voice assistant response library: `src/voice/assistantLibrary.js`
- Python voice parsing: `src/voice/voice_parser.py`
- Optional faster-whisper transcription: `src/voice/faster_whisper_transcribe.py`
- Trusted online research: `src/training/remoteKnowledge.js`

The current app does not fine-tune an LLM. It performs local data processing, tokenization, vectorization, similarity search, trusted-source ingestion, and a small softmax classifier trained at runtime with gradient descent. It is structured so a future local embedding model or clinical model can be added behind the same API.

Recommended production upgrades:

- Add a real embedding model such as `sentence-transformers` or a local ONNX embedding model.
- Add a vector database such as SQLite VSS, Chroma, LanceDB, or FAISS.
- Add a clinically reviewed medical knowledge base.
- Add OCR for images and scanned PDFs.
- Add robust PDF/XLSX/DOCX parsers.
- Add a real LLM layer with strict medical safety guardrails.
- Add clinician review workflows before any learned data becomes trusted.

## Folder Structure

```text
.
|-- public/
|   |-- index.html
|   |-- app.html
|   |-- chat.html
|   |-- result.html
|   |-- admin-login.html
|   |-- training.html
|   |-- trained-data.html
|   |-- css/
|   |-- js/
|   `-- assets/
|-- src/
|   |-- ai/
|   |-- reports/
|   |-- training/
|   |-- utils/
|   `-- tests/
|-- data/
|   |-- seed-medical-knowledge.json
|   |-- uploads/
|   `-- training/
|-- docs/
|-- package.json
|-- .gitignore
`-- README.md
```

## Data Files

Generated local files:

- `data/reports.json`
- `data/sessions.json`
- `data/training/manual-knowledge.json`
- `data/training/user-learning.json`
- `data/training/audit-log.json`

These are ignored by Git because they may contain private health information or local training data.

Seed knowledge is stored in:

```text
data/seed-medical-knowledge.json
```

It initializes the manual training store on first run.

## Medical Safety Rules In This Prototype

DOC avoids claiming a final diagnosis. It presents possible causes and urgency.

DOC does not provide exact prescription dosing. Medicine rows are discussion guides by active ingredient or class, with common examples and safety checks.

DOC filters medicine suggestions against obvious allergy/risk text. This is not enough for real prescribing.

DOC flags emergency phrases such as chest pain, breathing difficulty, stroke signs, severe bleeding, airway swelling, seizure, or loss of consciousness.

DOC also flags added red-alert patterns such as self-harm language, eye pain with vision loss, back pain with bladder/bowel symptoms, and severe dehydration or heat illness.

## Voice Assistant Behavior

The assistant page is now voice-first:

- Press `Start continuous voice`.
- Speak naturally.
- DOC sends the message after you pause.
- DOC speaks the answer back.
- While DOC is talking, the microphone pauses so DOC does not hear its own speaker audio. Listening resumes after the reply finishes.
- Upload files from the side panel; they attach to the next spoken turn or can be sent with `Send uploads`.

Browser support depends on the Web Speech API. Chrome/Edge usually support it best.

Voice understanding uses `src/voice/assistantLibrary.js` and `src/voice/voice_parser.py`, so answers do not need one exact phrase format. For example, when DOC asks for a name, `Rahul`, `my name is Rahul`, and `patient name is Rahul Kumar` are all accepted. When DOC asks age, `24`, `I am 24`, or `24 years old` are accepted. Conversational turns such as `hello`, `what is your name`, `how are you`, `what is your age`, `what can you do`, `repeat`, and `thank you` are answered as assistant interactions instead of being stored as symptoms or patient names.

The voice assistant now follows this guided order: greeting, name, age, symptoms, additional details and medical restrictions, optional visuals/photos/reports, confirmation, verbal assessment, then report generation only after the user confirms.

## Vector Training Files

Training mode accepts `.data`, `.vec`, and `.vector` files when they contain useful labeled vector data. A raw numeric vector alone cannot be decoded into human-readable medical meaning, so include text, tokens, or a labeled vector object.

Example:

```json
{
  "title": "Fever and cough vector",
  "category": "respiratory",
  "text": "Fever and cough can occur with viral respiratory infection...",
  "tokens": ["fever", "cough", "symptom", "treatment"],
  "vector": {
    "fever": 0.72,
    "cough": 0.54,
    "symptom": 0.33,
    "treatment": 0.2
  }
}
```

## Deployment Notes

For simple local demo:

```bash
npm start
```

For a public deployment:

1. Replace hardcoded admin credentials with environment variables and hashed passwords.
2. Use HTTPS.
3. Add authentication and role-based access.
4. Store uploads in encrypted object storage.
5. Store reports and training data in a database with access controls.
6. Add audit logs and consent screens for health data.
7. Do not expose private training data through the UI.
8. Add a real medical review workflow.
9. Add jurisdiction-specific privacy compliance such as HIPAA, GDPR, or local rules.
10. Put the backend behind a process manager or container.

Example container path:

```bash
docker build -t doc-medical-assistant .
docker run -p 3000:3000 doc-medical-assistant
```

A `Dockerfile` is not included yet because the current project intentionally has zero external runtime dependencies.

## Current Limitations

- The app does not ingest the entire medical internet. Unknown-topic fallback is limited to trusted MedlinePlus/NLM health-topic search.
- Uploaded images are stored as supporting evidence, but no diagnostic computer vision is performed.
- PDF, spreadsheet, and document extraction is best-effort only.
- Raw numeric vectors without token labels or source text cannot be decoded back into reliable medical meaning.
- User feedback is saved for review, not automatically trusted as medical truth.
- The report engine is a prototype retrieval/rules system, not a clinically validated AI model.

## Reference Sources Used For Seed Knowledge

- MedlinePlus broken bone first aid: https://medlineplus.gov/ency/article/000001.htm
- CDC common cold treatment guidance: https://www.cdc.gov/common-cold/treatment/index.html
- MedlinePlus fever overview: https://medlineplus.gov/ency/article/003090.htm
- FDA NSAID safety communication: https://www.fda.gov/Drugs/DrugSafety/ucm451800.htm
- MedlinePlus allergic reactions: https://medlineplus.gov/ency/article/000005.htm
- MedlinePlus chest pain: https://medlineplus.gov/ency/article/003079.htm
- MedlinePlus gastroenteritis: https://medlineplus.gov/gastroenteritis.html
- MedlinePlus headache: https://medlineplus.gov/headache.html
- MedlinePlus wounds and injuries: https://medlineplus.gov/woundsandinjuries.html
- MedlinePlus asthma: https://medlineplus.gov/asthma.html
- MedlinePlus pneumonia: https://medlineplus.gov/pneumonia.html
- MedlinePlus urinary tract infections: https://medlineplus.gov/urinarytractinfections.html
- MedlinePlus diabetes: https://medlineplus.gov/diabetes.html
- MedlinePlus high blood pressure: https://medlineplus.gov/highbloodpressure.html
- MedlinePlus back pain: https://medlineplus.gov/backpain.html
- MedlinePlus anxiety: https://medlineplus.gov/anxiety.html
- MedlinePlus depression: https://medlineplus.gov/depression.html
- MedlinePlus anemia: https://medlineplus.gov/anemia.html
- MedlinePlus sinusitis: https://medlineplus.gov/sinusitis.html
- MedlinePlus ear infections: https://medlineplus.gov/earinfections.html
- MedlinePlus pink eye: https://medlineplus.gov/pinkeye.html
- MedlinePlus GERD: https://medlineplus.gov/gerd.html
- CDC COVID-19 symptoms: https://www.cdc.gov/covid/signs-symptoms/index.html

## Rename Later

The temporary name is `DOC`. When the final name is ready, update:

- visible text in `public/*.html`
- `package.json` name/description
- README title and wording
- generated report title in `src/reports/reportRenderer.js`

## Reference Flow And Code Tree

```text
User browser
  |
  |-- public/index.html (landing screen and main menu)
  |-- public/app.html (manual intake form)
  |-- public/chat.html (voice assistant screen)
  |-- public/result.html (report viewer and feedback form)
  |
  v
src/server.js (local HTTP server and API router)
  |
  |-- /api/report (builds and stores report from manual intake)
  |-- /api/chat (runs voice/text assistant turn and can generate report)
  |-- /api/voice/transcribe (optional faster-whisper audio transcription)
  |-- /api/training/upload (admin-only training upload)
  |-- /api/training/items (admin-only trained-data inspection)
  |
  v
src/ai/medicalEngine.js (urgency, disease matching, medicine filtering, report JSON)
  |
  |-- src/training/vectorStore.js (raw text -> tokens -> normalized vectors -> cosine search)
  |-- src/training/neuralTrainer.js (forward propagation + backward propagation classifier)
  |-- src/training/fileProcessor.js (file extraction, validation, duplicate handling, training storage)
  |-- src/training/remoteKnowledge.js (trusted MedlinePlus/NLM fallback when local knowledge is weak)
  |
  v
src/reports/reportRenderer.js (turns report JSON into printable/downloadable HTML)
```

```text
DOC project tree
|-- package.json (run scripts and project metadata)
|-- requirements-voice.txt (optional faster-whisper Python dependency)
|-- scripts/
|   `-- importMedicalDataset.js (imports disease CSVs from sumeshverse dataset repo)
|-- src/
|   |-- server.js (API routes, static hosting, report/session storage)
|   |-- ai/
|   |   |-- medicalEngine.js (condition scoring, safety rules, medicine precision filter)
|   |   `-- chatAssistant.js (conversation state, slot filling, report trigger)
|   |-- reports/
|   |   `-- reportRenderer.js (report HTML with avoid/restriction section)
|   |-- training/
|   |   |-- vectorStore.js (training text cleanup, tokenization, vectorization, cosine search)
|   |   |-- fileProcessor.js (upload parsing, safety validation, duplicate comparison)
|   |   |-- neuralTrainer.js (small softmax model with forward/backward propagation)
|   |   `-- remoteKnowledge.js (online trusted-source training fallback)
|   |-- voice/
|   |   |-- assistantLibrary.js (voice assistant prompts, small-talk intents, Whisper prompt)
|   |   |-- voice_parser.py (parses spoken text into intake fields)
|   |   |-- transcriptionService.js (Node wrapper for faster-whisper transcription)
|   |   `-- faster_whisper_transcribe.py (Python faster-whisper adapter)
|   |-- utils/
|   |   `-- persistence.js (JSON file read/write helpers and data paths)
|   `-- tests/
|       `-- smoke.test.js (basic training/report safety test)
|-- public/
|   |-- js/
|   |   |-- shared.js (API helper, admin visibility, speech synthesis, menu behavior)
|   |   |-- chat.js (voice assistant, Web Speech API, Whisper recording fallback)
|   |   |-- intake.js (manual intake submission)
|   |   |-- training.js (admin upload flow)
|   |   |-- trained-data.js (admin trained-data viewer)
|   |   |-- result.js (report iframe, follow-up chat, feedback)
|   |   |-- admin.js (admin login)
|   |   `-- index.js (landing-page helpers)
|   |-- css/styles.css (application styling)
|   `-- assets/medical-dashboard.svg (landing visual)
`-- data/
    |-- seed-medical-knowledge.json (seed and imported disease knowledge)
    |-- reports.json (generated report history)
    |-- sessions.json (chat sessions)
    `-- training/
        |-- manual-knowledge.json (active manual/seed/imported training vectors)
        |-- user-learning.json (feedback saved for review)
        `-- audit-log.json (training import/upload audit events)
```
