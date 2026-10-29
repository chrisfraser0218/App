# Synthetic dataset

All 225 rows are invented examples for this portfolio demonstration, not bank records. Each of nine categories has 20 training descriptions and five held-out test descriptions. The CSV explicitly marks splits; training never fits TF-IDF or logistic regression on test rows. Descriptions are disjoint, but merchant names and vocabulary overlap intentionally. This is a known-vocabulary synthetic benchmark, not evidence of generalization to new merchants or real transactions. The training command produces a full classification report, confusion matrix, coverage, and accuracy after abstention.

`Other` contains miscellaneous fees, donations, education, and postage; it is not a reliable class for every unknown merchant. Unrecognized vocabulary abstains instead. Feedback is not imported automatically.
