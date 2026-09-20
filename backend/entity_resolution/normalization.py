from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit


def _collapse(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).casefold()


def normalize_person_name(value: str | None) -> str:
    """Normalize harmless case, whitespace, and punctuation differences."""
    return re.sub(r"[^\w\s]", "", _collapse(value or ""), flags=re.UNICODE)


def normalize_company_name(value: str | None) -> str:
    """Keep word boundaries while normalizing punctuation and whitespace."""
    value = re.sub(r"[&/.,()\-]+", " ", value or "")
    return re.sub(r"\s+", " ", value.strip()).casefold()


def normalize_domain(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip().casefold()
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    parsed = urlsplit(candidate)
    host = parsed.hostname
    if not host:
        return None
    if host.startswith("www."):
        host = host[4:]
    return host.rstrip(".")


def normalize_email(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip().casefold()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", candidate):
        return None
    return candidate


def normalize_profile_url(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return None
    if parsed.scheme.casefold() not in {"http", "https"} or not parsed.netloc:
        return None
    path = re.sub(r"/+$", "", parsed.path or "/") or "/"
    return urlunsplit((parsed.scheme.casefold(), parsed.netloc.casefold(), path, "", ""))


def parse_company_from_headline(headline: str | None) -> str | None:
    """Deterministically extracts company/employer names from typical LinkedIn headline formats."""
    if not headline:
        return None
    text = headline.strip()
    if not text:
        return None

    # Format 1 & 3: "@Company" or "Title @ Company" or "Title @Company | Skills"
    if "@" in text:
        segment = text.split("|")[0].strip()
        if "@" in segment:
            parts = segment.split("@", 1)
            company_candidate = parts[1].strip()
            company_candidate = re.sub(r"[\(\)\[\]]+", "", company_candidate).strip()
            if company_candidate:
                return company_candidate

    # Format 2: "Title at Company" (case-insensitive " at ")
    at_match = re.search(r"\s+at\s+", text, flags=re.IGNORECASE)
    if at_match:
        start_idx = at_match.end()
        remainder = text[start_idx:].strip()
        remainder = re.split(r"[|,\n]", remainder)[0].strip()
        remainder = re.sub(r"\s*\([^)]*\)", "", remainder).strip()
        if remainder:
            return remainder

    # Format 4: "Title | Company" where Company contains corporate / institutional indicators
    if "|" in text:
        segments = [s.strip() for s in text.split("|") if s.strip()]
        if len(segments) >= 2:
            second_segment = segments[1]
            corp_indicators = (
                r"\b(limited|ltd|inc|incorporated|corp|corporation|llc|co|pvt|private|"
                r"group|technologies|solutions|services|systems|bank|capital|partners|"
                r"holdings|labs|academy|university|college|institute|school|hospitals)\b"
            )
            if re.search(corp_indicators, second_segment, flags=re.IGNORECASE):
                return second_segment

    return None
