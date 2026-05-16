# AI-chatbot-for-medical-assistance-with-Disease-detection  /  DOC Medical Assistant Chartboard


DOC is a local-first prototype for a medical assistant and disease-detection style chartboard. It collects symptoms, visible findings, optional images/reports, allergies, current medicines, and extra notes, then generates a structured guidance report. It also includes a voice chat assistant and protected admin training mode.

> Safety scope: DOC is educational triage support, not a doctor, diagnosis engine, prescription system, or regulated medical device. Emergency symptoms need urgent local medical care.

## What Is Included

- Landing page with the temporary product name `DOC`.
- Manual intake flow for name, age, symptoms, visual observations, allergies, medicines, uploads, reports, and extra details.
- Voice/text chat assistant using browser speech recognition and speech synthesis where supported.
- Report generator with urgency flags, possible causes, first steps, restrictions, food/fluid guidance, medicine safety discussion, and medical-term explanations.
- Downloadable/printable report page.
- Admin-only training mode.
- Local training data processor with text extraction, tokenization, vectorization, duplicate detection, unsafe-claim rejection, and audit logging.
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
4. Voice chat collects the same information through a conversation.
5. Backend combines the input text and upload metadata.
6. The local retrieval engine searches trained knowledge vectors.
7. DOC generates a report and stores it locally.
8. User can print, save as PDF, download HTML, or submit feedback.
9. Feedback enters the user-learning bucket for review.

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

This prototype uses a local retrieval-plus-rules engine:

- Tokenization: `src/training/vectorStore.js`
- Vectorization: normalized term-frequency vectors
- Similarity: cosine similarity
- Training ingestion: `src/training/fileProcessor.js`
- Report generation: `src/ai/medicalEngine.js`
- Chat state: `src/ai/chatAssistant.js`

The current app does not train a neural network or fine-tune an LLM. It is structured so a future local model can be added behind the same API.

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

- The app cannot browse and ingest the entire medical internet. That would be unsafe and legally risky without source filtering, licensing, quality review, and clinical governance.
- Uploaded images are stored as supporting evidence, but no diagnostic computer vision is performed.
- PDF, spreadsheet, and document extraction is best-effort only.
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

## Rename Later

The temporary name is `DOC`. When the final name is ready, update:

- visible text in `public/*.html`
- `package.json` name/description
- README title and wording
- generated report title in `src/reports/reportRenderer.js`
