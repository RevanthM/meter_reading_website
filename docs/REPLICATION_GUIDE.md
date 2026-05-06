# Analog Gas Meter Reader — replication guide (KT anchor)

This file is the **persistent knowledge-transfer pointer** for the end-to-end system. The canonical narrative document is the PDF:

- **Local path (authoritative on your machine):** `/Users/reeti/Downloads/REPLICATION_GUIDE.pdf`  
- **Title (from PDF metadata):** *Analog Gas Meter Reader — End-to-End Replication Guide*  
- **Tip:** Copy or export that PDF into this repo (e.g. `docs/assets/REPLICATION_GUIDE.pdf`) if you want it versioned with the code.

## Outline (PDF table of contents / named sections)

Use the PDF for full prose, env vars, and step-by-step commands. Section anchors line up roughly as:

1. **System overview**
2. **Repository layout**
3. **Prerequisites**
4. **AWS infrastructure setup**
5. **Training pipeline**
6. **Converting trained models to Core ML**
7. **Integrating models into the iOS app**
8. **Building / archiving the iOS app (xcarchive workflow)**
9. **Running the meter reading portal**
10. **End-to-end smoke test**
11. **Troubleshooting**

## Repo map (this monorepo)

| Area | Path (relative to `AMR - Repos`) | Notes |
|------|-----------------------------------|--------|
| Meter reading portal (Node + React) | `meter_reading_website/` | S3 listing, status moves, ZIP export, usage summary, etc. See [ARCHITECTURE.md](./ARCHITECTURE.md). |
| iOS app | `iOS App/AnalogMeterReader_IOS/` | Core ML bundles (`*.mlpackage`), `MultiModelMeterService` / `MeterDialDetectionService`, capture + upload. |
| Training / export (Python) | `iOS App/AnalogMeterReader_IOS/training/` | e.g. `scripts/export_models.py` — PyTorch/YOLO → Core ML; not executed on device. |

## When touching “models + iOS”

- **Device inference:** Swift + **Core ML / Vision** only; Python scripts are for **train + export** (or parity), not on-phone runtime.
- **Bundle resource names** expected by the app today include `DialDetector`, `DirectionClassifier`, `DigitClassifier` (multi-model path) and `MeterDialDetector` (single-model path); see `AnalogMeterReader/Services/*.swift`.

## Related portal docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — S3 contract, APIs, portal behavior.  
- [DYNAMODB_AND_PIPELINE_ROADMAP.md](./DYNAMODB_AND_PIPELINE_ROADMAP.md) — future indexing / Lambda vs iOS.

---

*If the PDF moves, update the path at the top of this file so KT stays accurate.*
