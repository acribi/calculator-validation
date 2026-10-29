# Acribi calculator validation cases

Test cases for metrology calculators, each one traced to a worked example in a published source: JCGM (GUM and JCGM 106), NASA measurement quality handbooks, Global ACI (formerly ILAC), European Accreditation, UKAS, NIST, IAPWS and OIML.

[Acribi](https://acribi.com) is a vendor-neutral reference on calibration and metrology. Its free browser calculators are checked against these cases before they are published. This repository makes the cases public so that anyone can check their own spreadsheet, script or software against the same examples.

**202 cases, 360 checks**, in plain JSON. Every case gives the inputs with units, the expected outputs with units and tolerance, and the exact location of the example in the source (document, edition, section, example, table, page).

## Why this exists

Most metrology formulas are simple to write and easy to get slightly wrong: a coverage factor rounded too early, ν_eff not truncated, a tolerance width used where a half-width belongs, a guard band applied on the wrong side. The standards and guides contain worked examples that settle these questions, but the numbers are scattered across dozens of PDFs and are not machine-readable.

This repository collects them in one place, with the conventions spelled out, so that you can:

- validate a calculator, spreadsheet or library against published results;
- see exactly which examples reproduce, to how many digits, and which do not (with the reason);
- cite a fixed, versioned set of test cases in a validation report, a course or a paper.

## What's covered

| Calculation | Cases | Sources | Used on acribi.com |
|---|---:|---|---|
| [TUR, TAR and decision risk](cases/tur-risk.json) (specific risk, global PFA/PFR, EOPR, guard bands for a target risk) | 43 | JCGM 106:2012; NASA-HDBK-8739.19-4; Global ACI-TECH-1-002 (formerly ILAC G8:09/2019); Mimbs (NASA KSC, 2007 and 2011) | [TUR calculator](https://acribi.com/tools/tur-calculator/) |
| [Guard banding and decision rules](cases/guard-banding.json) | 29 | UKAS LAB 48 Ed. 5 (2024); Dobbert (2008) | [Guard banding guide](https://acribi.com/learn/measurement-uncertainty/guard-banding/) |
| [Uncertainty budget](cases/uncertainty-budget.json) (Type A, Type B divisors, Welch–Satterthwaite, Student t, dominant rectangular term) | 50 | JCGM 100:2008 (GUM); EA-4/02 M:2022; UKAS M3003 Ed. 6 (2024); JCGM GUM-5:2026; NIST TN 1297 | [Uncertainty calculator](https://acribi.com/tools/uncertainty-calculator/) |
| [Gauge R&R](cases/gauge-rr.json) (ANOVA, average and range, d2/d3/d2*, F distribution) | 23 | SPC for Excel; Ermer (Quality Progress, 2006); NIST/SEMATECH e-Handbook | [Gauge R&R calculator](https://acribi.com/tools/gauge-rr-calculator/) |
| [Gravimetric pipette calibration](cases/pipette-gravimetric.json) (water density, Z factor, volume) | 12 | NIST IR 7383-2019 (GLP 10); Eppendorf; INTEGRA | [Pipette calibration procedure](https://acribi.com/instruments/pipette/calibration-procedure/) |
| [Calibration interval reliability model](cases/calibration-interval.json) | 1 | NASA-HDBK-8739.19-3 | [Calibration intervals guide](https://acribi.com/learn/calibration-program/calibration-intervals/) |
| [Pressure gauges](cases/pressure-gauge.json) (normal gravity, liquid head, error as % of span) | 5 | 40 CFR 1065.630; NIST SP 811; USBR 1040 | [Pressure gauge calibration procedure](https://acribi.com/instruments/pressure-gauge/calibration-procedure/) |
| [Scales and balances](cases/scale-balance.json) (maintenance and acceptance tolerances, maximum permissible errors) | 17 | NIST Handbook 44 (2026); NIST HB 105-1; OIML R 76-1:2006 | [Scale calibration procedure](https://acribi.com/instruments/scale/calibration-procedure/) |
| [Boiling point of water](cases/boiling-point.json) (pressure and altitude) | 22 | IAPWS R7-97(2012); NIST Chemistry WebBook; FAA-H-8083-25B; USDA FSIS | [Thermometer calibration procedure](https://acribi.com/instruments/thermometer/calibration-procedure/) |

Of the 202 cases, 157 come from official sources (standards bodies, national metrology institutes, accreditation bodies, government agencies) and 45 from secondary ones (journal and conference papers, manufacturers, software vendors). Each case says which in `source.kind`. Most gauge R&R cases are secondary (a journal article and a software vendor); only the F-distribution checks come from NIST.

## How a case looks

```json
{
  "id": "tur-risk/jcgm106-7.3.3-ex1",
  "calculator": "tur-risk",
  "operation": "specific-risk",
  "title": "Probability of conformity, Zener voltage with an upper limit",
  "inputs": {
    "measured_value": { "value": -5.47, "unit": "V" },
    "standard_uncertainty": { "value": 0.05, "unit": "V" },
    "tolerance_lower": { "value": null, "unit": "V" },
    "tolerance_upper": { "value": -5.4, "unit": "V" }
  },
  "expected": {
    "probability_of_conformity": {
      "value": 0.92, "unit": "1", "tolerance": 0.005, "published": "0.92",
      "recomputed": { "value": 0.91924, "tolerance": 0.00005 }
    }
  },
  "source": {
    "document": "JCGM 106:2012 Evaluation of measurement data – The role of measurement uncertainty in conformity assessment (also ISO/IEC Guide 98-4:2012)",
    "publisher": "JCGM / BIPM",
    "edition": "2012, 1st edition",
    "location": "§7.3.3, Example 1, p. 15",
    "url": "https://www.bipm.org/documents/20126/2071204/JCGM_106_2012_E.pdf",
    "kind": "official"
  }
}
```

Conventions:

- **`value` is the published value**, and `tolerance` is absolute, in the same unit. By default it is half a unit of the last digit printed by the source. When a wider tolerance is needed (the source rounded an intermediate value, or read a value from a table), the case says why in `notes`.
- **`recomputed`** (optional) is a higher-precision value that Acribi computed from the published inputs. It is not a published value; it is there so that you can check an implementation more tightly than the printed digits allow.
- **`atMost`** is used when the source gives a bound ("less than 2.5 %") instead of a value. **`equals`** is used for integers and yes/no results.
- **`published`** is the value as printed, for reference.
- **`null`** stands for an absent tolerance limit (one-sided tolerance) or for infinite degrees of freedom.
- **Units:** `"1"` means dimensionless (probabilities are fractions, not percent, unless the unit says `%`).
- **`operation`** names the calculation in [runner/operations.mjs](runner/operations.mjs). Read that file for the exact meaning of each input and output; it is short.

The schema is in [cases/_schema.json](cases/_schema.json).

## Run the checks

Requires Node.js 22.6 or later. No dependencies, nothing to install.

```sh
npm test               # all case files
npm test -- gauge-rr   # only files whose name contains "gauge-rr"
VERBOSE=1 npm test     # print every check, not only failures
```

Expected output:

```
ok    boiling-point.json            22 cases  22/22 checks
ok    calibration-interval.json      1 cases  3/3 checks
ok    gauge-rr.json                 23 cases  52/52 checks
ok    guard-banding.json            29 cases  42/42 checks
ok    pipette-gravimetric.json      12 cases  13/13 checks
ok    pressure-gauge.json            5 cases  5/5 checks
ok    scale-balance.json            17 cases  33/33 checks
ok    tur-risk.json                 43 cases  79/79 checks
ok    uncertainty-budget.json       50 cases  111/111 checks

202 cases, 360/360 checks passed
```

The reference implementation in [reference/](reference/) is the calculation code of the acribi.com calculators, copied without the user interface. It is TypeScript that Node runs directly with type stripping.

## Use the cases in your own project

The case files are plain JSON, so any language can read them. A minimal loop:

```python
import json
from my_lib import specific_risk  # your implementation

cases = json.load(open("cases/tur-risk.json"))["cases"]
for c in cases:
    if c["operation"] != "specific-risk":
        continue
    i = {k: v["value"] for k, v in c["inputs"].items()}
    lower = i["tolerance_lower"] if i["tolerance_lower"] is not None else float("-inf")
    upper = i["tolerance_upper"] if i["tolerance_upper"] is not None else float("inf")
    got = specific_risk(i["measured_value"], i["standard_uncertainty"], lower, upper)
    for name, exp in c["expected"].items():
        if "value" in exp:
            assert abs(got[name] - exp["value"]) <= exp["tolerance"], (c["id"], name)
```

Suggestions:

- Map each `operation` to a function in your code. You do not need to support them all.
- Check against `value` and `tolerance` to claim agreement with the published example. Use `recomputed`, where present, as a stricter regression test.
- Keep the case `id` in your test names, so a failure points straight to the source.
- When you cite a result, cite the original source in `source`, and this repository for the selection and conventions.

## What is not included, and why

Some worked examples were left out on purpose. Each of these is documented so that you do not have to rediscover it:

- **Sources whose license does not allow redistribution under CC BY 4.0.** Worked examples from documents published under non-commercial or no-derivatives terms are deliberately excluded, even where they reproduce exactly: the EURAMET calibration guides (for example cg-3, cg-17, cg-18 and cg-19) and the PTB/DKD guidelines (for example DKD-R 5-1, DKD-R 6-1 and DKD-R 8-1). The AIAG MSA 4th edition example data set (as republished by Minitab and SPC for Excel) is also left out, because it comes from a paid manual. These documents are good references; read them at their publishers' sites.
- **Values that do not reproduce from the published inputs.** The false-accept column of NASA-HDBK-8739.19-4 Table 5-2 (not monotonic; likely editing errors). The coverage factor k = 1.81 in EA-4/02 S11 (the guide's own formula S10.10 gives 1.80). The combined uncertainty of EA-4/02 S7 (a typo in the contributions column). Ermer's "new method" and "ANOVA" columns (EV and AV appear swapped).
- **Values read from graphs** rather than printed (for example NASA-HDBK-8739.19-4 Figure 5-1).
- **Methods the calculators do not implement**: Bayesian guard bands (NASA-HDBK-8739.19-4 Table 5-3), non-normal priors (JCGM 106 §9.5.4), correlated inputs (GUM H.2, GUM-5 covariance examples), least-squares calibration curves (GUM H.3) and nested gauge studies (NIST e-Handbook 2.4.4).
- **Acribi's own calculations** with no published counterpart (comparisons of guard band methods, the fictitious worked examples on the instrument pages, edge cases). These remain in Acribi's internal test suite, not here.

## A note on copyright

This repository contains numbers and citations only. It does not reproduce text, figures or tables from ISO standards or any other copyrighted document. Where a case needs explanation, the explanation is our own wording. A few cases use the published readings of a worked example (for example the gauge R&R data sets) because the result cannot be checked without them; where a published table is long, only a subset of cells is included.

Read the source documents at the URLs given in each case; many are free to download from their publishers.

## Report a discrepancy

If a case looks wrong, or your implementation disagrees with a case and you believe the case is at fault, please [open an issue](https://github.com/acribi/calculator-validation/issues) with the case `id`, what you expected and why (ideally with the page of the source). You can also write to [hello@acribi.com](mailto:hello@acribi.com).

New cases are welcome under the same rule: a published worked example, with a precise citation, that reproduces from its own inputs.

## License

- Code (`reference/`, `runner/`): [MIT](LICENSE).
- Case data (`cases/`): [CC BY 4.0](LICENSE-data). Please credit Acribi and the original source of each case. The license covers our selection, structure and annotations; the source documents remain under their publishers' terms.

To cite this repository, see [CITATION.cff](CITATION.cff).
