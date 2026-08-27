#!/usr/bin/env python3
import json
import sys
sys.path.insert(0, "run/scripts")
from credit_matcher import match

# NOTE: These texts are WebSearch's own synthesized answer text (an LLM
# paraphrase of retrieved results), NOT raw fetched page bytes. This is a
# PROVISIONAL sanity check of the matcher's discrimination logic only. It
# does not satisfy spec section 3.4, which requires the matcher to be run
# against the live fetched bytes of 15 known-crediting and 15 known
# non-crediting documents. That pass is blocked pending resolution of the
# live-fetch capability gap (see preflight.json / surfaces_blocked.json).

docs = [
    {"id": "kidder_mathews_q2_2026", "label": "credited", "text": "I found several Kidder Mathews market reports that cite CoStar as their data source. San Diego Retail Market Report (Q2 2026): The average retail sale price in San Diego was $446 per square foot. All of these reports are compiled by the Kidder Mathews Research Group and cite CoStar as their source."},
    {"id": "crow_holdings_industrial", "label": "credited", "text": "Crow Holdings uses CoStar data as a source for industrial market information, such as tracking tenant information for industrial properties. Crow Holdings Development's projects have been recognized in the 2025 CoStar Impact Awards for the Dallas/Fort Worth market."},
    {"id": "hughes_marino_sf_office_q2_2026", "label": "credited", "text": "Q2 2026 San Francisco Office Market Report: This report provides market statistics from CoStar Group. Tenants leased 2.8M SF in Q2 2026. The Office Market Has Bottomed Out (February 2026): This report uses market statistics provided by CoStar Group and covers availability rates across major U.S. metro markets."},
    {"id": "voit_market_reports", "label": "credited", "text": "Voit Real Estate Services regularly incorporates CoStar data into their market reports. Office Market: CoStar is reporting that U.S. office leasing remained steady in Q2 2026. Industrial Market: CoStar projected that the U.S. national industrial vacancy rate would continue to rise in 2026."},
    {"id": "thalhimer_market_share", "label": "credited", "text": "A Richmond Medical Office Emerging Trends Q4 2025 report sourced from CoStar, published by Cushman & Wakefield | Thalhimer. Cushman & Wakefield | Thalhimer holds the #1 position for overall market share in Virginia for Q1 2026, as ranked by CoStar."},
    {"id": "bradford_allen_research", "label": "credited", "text": "Bradford Allen's research team has analyzed recent CoStar data, and the company has released various office market reports, including Q2/25 Office Market Report: Downtown Chicago. Bradford Allen won a CoStar Impact Award for a commercial real estate transaction."},
    {"id": "reonomy_costar_alternative", "label": "not_credited", "text": "Reonomy is a CRE online data resource positioned as a CoStar alternative. CoStar and Reonomy solve different problems - CoStar is the breadth-and-analytics market data incumbent while Reonomy is the ownership-and-contact intelligence layer. CoStar membership starts at $466 per month, with Reonomy cost reported at about $300."},
    {"id": "compstak_vs_costar", "label": "not_credited", "text": "Comparison resources for CompStak versus CoStar. CompStak provides commercial real estate transaction data through a platform where users can access lease comps, sale comps, loan data. CoStar Group provides online real estate marketplaces, information, and analytics solutions. CompStak is emerging as a competitor to CoStar."},
    {"id": "crexi_switched_from_costar", "label": "not_credited", "text": "A reference to a customer story about switching from CoStar to Crexi. One Crexi customer has been a user for many years and found the value of their product, technology, and customer service superior to CoStar without the price and hassle."},
    {"id": "costar_technologies_video_surveillance", "label": "not_credited", "text": "Costar Technologies, Inc. designs, develops, manufactures, and distributes a range of products for the video surveillance and machine vision markets. Subsidiaries include Arecont Vision Costar, Costar Video Systems, CostarHD Costar. Public company (OTC Markets Group CSTI) based in Coppell, TX."},
    {"id": "corning_costar_pipettes", "label": "not_credited", "text": "Corning Costar Stripette serological pipettes come with paper/plastic wrapping. These pipets feature clear, bidirectional graduations. Corning Costar Disposable Aspirating Pipets are ideal for aseptically aspirating liquids. Corning Costar Reagent Reservoirs are the essential solution for multichannel pipetting."},
    {"id": "costar_group_csgp_earnings", "label": "not_credited", "text": "CoStar Group reported Q2 2026 quarterly revenue of $925 million, up from $781 million a year earlier, with net income of $55 million. Basic and diluted EPS were $0.14 for the quarter. CoStar Group (CSGP) has seen a 7.7% stock increase since its last earnings report."},
]

results = []
tp = fp = tn = fn = 0
for d in docs:
    verdict = match(d["text"])
    predicted_credited = verdict["credited"]
    actual_credited = d["label"] == "credited"
    if actual_credited and predicted_credited:
        tp += 1
        outcome = "TP"
    elif (not actual_credited) and predicted_credited:
        fp += 1
        outcome = "FP"
    elif actual_credited and (not predicted_credited):
        fn += 1
        outcome = "FN (matcher missed it - acceptable, becomes Not Found)"
    else:
        tn += 1
        outcome = "TN"
    results.append({"id": d["id"], "label": d["label"], "outcome": outcome, "verdict": verdict})

summary = {
    "note": "PROVISIONAL calibration on WebSearch-synthesized text, not raw fetched bytes. Not a substitute for spec section 3.4.",
    "n_docs": len(docs),
    "true_positives": tp,
    "false_positives": fp,
    "true_negatives": tn,
    "false_negatives_acceptable": fn,
    "false_positive_rate": f"{fp}/{len([d for d in docs if d['label']=='not_credited'])}",
    "results": results,
}
print(json.dumps(summary, indent=2))
