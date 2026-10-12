from __future__ import annotations

import csv
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "user-stories.md"
OUTPUT = ROOT / "output" / "zoho" / "InsurShield_MVP_Backlog_v0.10_Zoho_Import.csv"


MILESTONES = {
    "C1": "M0 - Foundations & Controlled Catalogue",
    "C2": "M1 - Quote to Policy",
    "C3": "M1 - Quote to Policy",
    "C4": "M2 - Accounts, Portfolio, Reputation & Renewal",
    "C5": "M3 - Claims, NCD & Inspections",
    "C6": "M2 - Accounts, Portfolio, Reputation & Renewal",
    "V1": "M0 - Foundations & Controlled Catalogue",
    "V3": "M0 - Foundations & Controlled Catalogue",
    "V4": "M2 - Accounts, Portfolio, Reputation & Renewal",
    "A1": "M0 - Foundations & Controlled Catalogue",
    "A2": "M0 - Foundations & Controlled Catalogue",
    "A3": "M1 - Quote to Policy",
    "A4": "M2 - Accounts, Portfolio, Reputation & Renewal",
}

V2_MILESTONES = {
    "US-VEN-005": "M1 - Quote to Policy",
    "US-VEN-006": "M1 - Quote to Policy",
    "US-VEN-007": "M1 - Quote to Policy",
    "US-VEN-008": "M3 - Claims, NCD & Inspections",
    "US-VEN-009": "M3 - Claims, NCD & Inspections",
    "US-VEN-010": "M3 - Claims, NCD & Inspections",
}


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def parse_stories(lines: list[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    current_role = ""
    current_epic_code = ""
    current_epic_name = ""
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        if line == "## 4. Customer user stories":
            current_role = "Customer"
        elif line == "## 5. Insurance vendor user stories":
            current_role = "Insurance Vendor"
        elif line == "## 6. InsurShield administrator user stories":
            current_role = "Administrator"
        elif line.startswith("### Epic "):
            match = re.match(r"### Epic ([A-Z]\d+) - (.+)", line)
            if match:
                current_epic_code, current_epic_name = match.groups()
        elif line.startswith("#### US-"):
            story_match = re.match(r"#### (US-[A-Z]+-\d+) - (.+)", line)
            if not story_match:
                i += 1
                continue
            story_id, title = story_match.groups()
            priority = ""
            requirements = ""
            user_story = ""
            acceptance: list[str] = []
            j = i + 1
            while j < len(lines) and not lines[j].strip().startswith(("#### US-", "### Epic ", "## ")):
                item = lines[j].strip()
                if item.startswith("**Priority:**"):
                    priority = item.split(":**", 1)[1].strip()
                elif item.startswith("**Requirement references:**"):
                    requirements = item.split(":**", 1)[1].strip()
                elif item.startswith("**User story:**"):
                    user_story = item.split(":**", 1)[1].strip()
                elif item.startswith("- Given "):
                    acceptance.append(item[2:].strip())
                j += 1

            milestone = V2_MILESTONES.get(story_id) or MILESTONES.get(current_epic_code, "")
            task_list = f"{current_epic_code} - {current_epic_name}"
            description_parts = [
                f"User type: {current_role}",
                f"Proposed milestone: {milestone}",
                f"Requirements: {requirements}",
                "",
                f"User story: {user_story}",
                "",
                "Acceptance criteria:",
            ]
            description_parts.extend(f"- {criterion}" for criterion in acceptance)
            rows.append(
                {
                    "Task Name": f"{story_id} - {title}",
                    "Task List Name": task_list,
                    "Description": "\n".join(description_parts),
                    "Status": "Open",
                    "Priority": "High" if priority == "Must" else "Medium",
                    "Tags": f"MVP, {current_role}, {current_epic_code}, v0.10",
                    "Proposed Milestone": milestone,
                    "Requirement References": requirements,
                }
            )
            i = j - 1
        i += 1
    return rows


def parse_enablers(lines: list[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    in_enablers = False
    for raw in lines:
        line = raw.strip()
        if line == "## 7. Platform enabler stories":
            in_enablers = True
            continue
        if in_enablers and line.startswith("## "):
            break
        if not in_enablers:
            continue
        match = re.match(r"- (EN-\d+): (.+)", line)
        if not match:
            continue
        enabler_id, title = match.groups()
        milestone = "M0 - Foundations & Controlled Catalogue"
        rows.append(
            {
                "Task Name": f"{enabler_id} - {title}",
                "Task List Name": "Platform Enablers",
                "Description": (
                    "User type: Platform / Cross-cutting\n"
                    f"Proposed milestone: {milestone}\n\n"
                    f"Enabler: {title}\n\n"
                    "Completion must be demonstrated through the applicable security, integration, "
                    "data, accessibility, observability, testing, and operational acceptance evidence."
                ),
                "Status": "Open",
                "Priority": "High",
                "Tags": "MVP, Platform, Enabler, v0.10",
                "Proposed Milestone": milestone,
                "Requirement References": "Cross-cutting NFRs and Definition of Done",
            }
        )
    return rows


def main() -> None:
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    rows = parse_stories(lines) + parse_enablers(lines)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "Task Name",
        "Task List Name",
        "Description",
        "Status",
        "Priority",
        "Tags",
        "Proposed Milestone",
        "Requirement References",
    ]
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Created {OUTPUT}")
    print(f"Rows: {len(rows)}")
    print(f"Task lists: {len(set(row['Task List Name'] for row in rows))}")


if __name__ == "__main__":
    main()
