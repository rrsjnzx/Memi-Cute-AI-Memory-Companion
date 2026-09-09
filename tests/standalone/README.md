# Standalone localhost acceptance harness

This directory is the independent localhost test harness carried over from the 0.12.2 development package.

Generate its test-only `product/` copy from the real extension first:

```bash
python prepare-copy.py ../../extension
npm test
python verify-package.py --source ../../extension
```

`prepare-copy.py` intentionally rewrites a small number of paths/bridges so the UI can run against local mock pages. Therefore **the generated `product/` directory is not a browser extension release and must not be loaded from `chrome://extensions` or `edge://extensions`.** The real extension lives at repository root `extension/`.
