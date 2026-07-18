const { normalizeText, tokenize, vectorize } = require("./vectorStore");

function labelKey(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function collectVocabulary(examples, maxFeatures) {
  const counts = new Map();
  for (const example of examples) {
    for (const token of tokenize(example.text)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFeatures)
    .map(([token]) => token);
}

function encodeFeatures(text, vocabulary) {
  const sparseVector = vectorize(tokenize(text));
  return vocabulary.map((token) => sparseVector[token] || 0);
}

function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - maxLogit));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

// Forward propagation:
// The feature vector flows through a tiny linear classifier. Each label gets a
// score (logit), and softmax turns those scores into probabilities.
function forward(features, model) {
  const logits = model.labels.map((_, labelIndex) => {
    let score = model.bias[labelIndex];
    for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
      score += features[featureIndex] * model.weights[labelIndex][featureIndex];
    }
    return score;
  });
  return {
    logits,
    probabilities: softmax(logits)
  };
}

// Backward propagation:
// Cross-entropy + softmax gives a simple gradient: predicted probability minus
// the correct target. We push weights away from wrong labels and toward the
// correct disease label using gradient descent.
function backward(features, targetIndex, probabilities, model, learningRate, l2Penalty) {
  for (let labelIndex = 0; labelIndex < model.labels.length; labelIndex += 1) {
    const target = labelIndex === targetIndex ? 1 : 0;
    const error = probabilities[labelIndex] - target;
    model.bias[labelIndex] -= learningRate * error;

    for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
      const currentWeight = model.weights[labelIndex][featureIndex];
      const gradient = error * features[featureIndex] + l2Penalty * currentWeight;
      model.weights[labelIndex][featureIndex] -= learningRate * gradient;
    }
  }
}

function buildNeuralConditionModel(rawExamples = [], options = {}) {
  const maxFeatures = options.maxFeatures || 180;
  const epochs = options.epochs || 28;
  const learningRate = options.learningRate || 0.45;
  const l2Penalty = options.l2Penalty || 0.0005;
  const examples = rawExamples
    .map((example) => ({
      label: normalizeText(example.label || example.name),
      key: labelKey(example.key || example.label || example.name),
      text: normalizeText(example.text || "")
    }))
    .filter((example) => example.label && example.key && tokenize(example.text).length >= 2);

  const labelMap = new Map();
  for (const example of examples) {
    if (!labelMap.has(example.key)) labelMap.set(example.key, example.label);
  }

  const labels = [...labelMap.entries()].map(([key, label]) => ({ key, label }));
  if (labels.length < 2 || examples.length < 2) return null;

  const vocabulary = collectVocabulary(examples, maxFeatures);
  const model = {
    labels,
    vocabulary,
    weights: labels.map(() => Array(vocabulary.length).fill(0)),
    bias: labels.map(() => 0),
    exampleCount: examples.length,
    epochs
  };
  const labelIndexByKey = new Map(labels.map((label, index) => [label.key, index]));

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const example of examples) {
      const features = encodeFeatures(example.text, vocabulary);
      const targetIndex = labelIndexByKey.get(example.key);
      const { probabilities } = forward(features, model);
      backward(features, targetIndex, probabilities, model, learningRate, l2Penalty);
    }
  }

  return model;
}

function predictCondition(model, text, options = {}) {
  if (!model) return [];
  const limit = options.limit || 3;
  const features = encodeFeatures(text, model.vocabulary);
  const { probabilities } = forward(features, model);
  return model.labels
    .map((label, index) => ({
      ...label,
      probability: Number(probabilities[index].toFixed(4))
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit);
}

module.exports = {
  buildNeuralConditionModel,
  predictCondition,
  forward,
  backward
};
