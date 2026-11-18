"""Bridge between the Node app and the vendored product-manager-toolkit scripts.

Reads one JSON object on stdin, writes one JSON object on stdout:

  in:  {"features": [{"id", "name", "reach", "impact", "confidence", "effort"}],
        "capacity": <person-months per quarter>,
        "interviews": [{"id", "text"}]}
  out: {"rice": {"features", "analysis", "roadmap"},
        "interviews": {"per": [{"id", ...analysis}], "aggregate": {...}}}

The scoring and text analysis are done by the vendored scripts, unmodified.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vendor", "claude-skills", "product-manager-toolkit", "scripts"))

from customer_interview_analyzer import InterviewAnalyzer, aggregate_interviews  # noqa: E402
from rice_prioritizer import RICECalculator  # noqa: E402


def main() -> None:
    payload = json.load(sys.stdin)
    out = {}

    features = payload.get("features") or []
    if features:
        calc = RICECalculator()
        ranked = calc.prioritize_features(features)
        out["rice"] = {
            "features": ranked,
            "analysis": calc.analyze_portfolio(ranked),
            "roadmap": calc.generate_roadmap(ranked, int(payload.get("capacity") or 10)),
        }

    interviews = payload.get("interviews") or []
    if interviews:
        analyzer = InterviewAnalyzer()
        per = []
        for item in interviews:
            analysis = analyzer.analyze_interview(item.get("text", ""))
            per.append({"id": item.get("id"), **analysis})
        out["interviews"] = {"per": per, "aggregate": aggregate_interviews(per)}

    json.dump(out, sys.stdout, default=list)


if __name__ == "__main__":
    main()
