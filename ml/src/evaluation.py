"""Measure model quality and choose the decision threshold.

Placeholder: the metrics are undecided. Whatever is chosen is recorded in the
model metadata's "metrics" object, and the selected cut-off in "threshold".
"""


def evaluate_model(model, features, labels):
    """Score held-out data and return a mapping of metric names to values.

    TODO: Choose metrics suited to the class balance of the real dataset.
    """
    raise NotImplementedError("Evaluation metrics have not been chosen yet")


def choose_threshold(model, features, labels):
    """Return the score cut-off used to flag high-risk behaviour.

    TODO: Decide how the threshold is selected once metrics are agreed.
    """
    raise NotImplementedError("Threshold selection is not implemented yet")
