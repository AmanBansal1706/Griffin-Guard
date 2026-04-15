import re
from typing import Dict, List

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"\+?[0-9][0-9\-\(\) ]{8,}[0-9]")
CC_RE = re.compile(r"\b(?:\d[ -]*?){13,16}\b")
API_KEY_RE = re.compile(r"(?i)(api[_\-]?key|token|secret)[=: ]+[a-z0-9\-_]{12,}")


def tag_payload(text: str) -> Dict[str, List[str] | str]:
    leaks: List[str] = []
    risk_score = 0
    if EMAIL_RE.search(text):
        leaks.append("EMAIL")
        risk_score += 20
    if PHONE_RE.search(text):
        leaks.append("PHONE")
        risk_score += 20
    if CC_RE.search(text):
        leaks.append("CREDIT_CARD")
        risk_score += 40

    if API_KEY_RE.search(text):
        leaks.append("TOKEN")
        risk_score += 50

    severity = "SAFE"
    if risk_score >= 20:
        severity = "RED_FLAG"
    if risk_score >= 50:
        severity = "CRITICAL"
    return {"tag": severity, "entities": sorted(set(leaks)), "risk_score": str(risk_score)}
