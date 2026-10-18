// Checks that the simulation (simulation/model.js) makes exactly the same
// decisions, times and reasoning as the Python program (results/results.json).
//   python code/main.py && node tools/check_parity.js
const path = require("path");
const fs = require("fs");
const model = require(path.join(__dirname, "..", "simulation", "model.js"));

const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "results", "results.json"), "utf8"));
const actual = model.runAll();
let failures = 0;

for (const exp of expected.agents) {
  const act = actual.find((a) => a.key === exp.key);
  if (!act) { console.log("MISSING agent " + exp.agent); failures++; continue; }
  for (const et of exp.tests) {
    const at = act.tests.find((t) => t.test === et.test);
    for (const field of ["route", "minutes", "on_time", "note"]) {
      if (at[field] !== et[field]) {
        console.log(`${exp.agent} test ${et.test} ${field}: python=${et[field]} js=${at[field]}`);
        failures++;
      }
    }
    et.reasoning.forEach((line, i) => {
      if (at.reasoning[i] !== line) {
        console.log(`${exp.agent} test ${et.test} reasoning[${i}]:\n  python: ${line}\n  js:     ${at.reasoning[i]}`);
        failures++;
      }
    });
    if (at.reasoning.length !== et.reasoning.length) {
      console.log(`${exp.agent} test ${et.test}: reasoning length differs`);
      failures++;
    }
  }
}

if (failures) {
  console.log(`\nPARITY FAILED: ${failures} difference(s).`);
  process.exit(1);
}
console.log(`Parity OK: ${expected.agents.length} agents x ${expected.scenarios.length} tests match the Python results.`);
