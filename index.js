const Tagger = require("pos-tagger.js");
const { exec } = require('child_process');
const { writeFileSync, readFileSync } = require('fs');
const inquirer = require('inquirer');

let rules = [
  'START NNP 1',
  '1 VBZ 2',
  '2 JJ 3',
  '3 . END'
];

let newNext = 4;

const createRule = (rule) => `  (rule ${rule})`;

let commands = `(deffacts facts
; ADD RULES HERE
)

(defrule apply_end_rule
  (rule ?prev ?first END)
  ?s <- (sentence ?prev ?first)
  =>
  (assert (sentence END))

  (retract ?s)
)

(defrule apply_rule
  (rule ?prev ?first ?next)
  ?s <- (sentence ?prev ?first $?rest)
  =>
  (assert (sentence ?next $?rest))

  (retract ?s)
)

(defrule success
  ?s <- (sentence END)
  =>
  (printout t "RESULT: SUCCESS" crlf)

  (retract ?s)
)

(defrule failure
  ?s <- (sentence $?)
  =>
  (printout t "RESULT: FAILURE" crlf)

  (retract ?s)
)

(reset)

; ADD ASSERTION HERE

(dribble-on output.txt)

(run)

(dribble-off)

(exit)
`;

const tagger = new Tagger(Tagger.readModelSync("left3words-wsj-0-18"));
function tagSentences(text) {
  const tagged = tagger.tag(text);
  return tagged.map(sentence => ({
    sentence: sentence.map(({ word }) => word).join(' '),
    tags: sentence.map(({ tag }) => tag)
  }));
}

function execCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error) => {
      if (error) {
        console.warn(error);
        reject()
      }
      resolve();
    });
  });
}

async function runClipsCommands(tags) {
  const sentence = `START ${tags.join(' ')}`;
  writeFileSync('commands.clp', commands.replace(
    '; ADD RULES HERE',
    rules.map(rule => createRule(rule)).join('\n')
  ).replace(
    '; ADD ASSERTION HERE',
    `(assert (sentence ${sentence}))`));
  await execCommand('./clips -f commands.clp')
  const output = readFileSync('./output.txt', 'utf8');
  const res = output.match(/(?<=RESULT: ).*/)[0];
  if (res === 'SUCCESS') {
    return true;
  } else if (res === 'FAILURE') {
    return false;
  }
}

async function learnText(text) {
  const taggedSentences = tagSentences(text);
  for (const { tags } of taggedSentences) {
    const result = await runClipsCommands(tags);
    if (!result) {
      let i = 0;
      let prev = 'START';
      do {
        let tag = tags[i];
        let next = newNext;
        if (i === tags.length - 1) {
          next = 'END';
        } else {
          const nextRegex = new RegExp(`.*(?= ${tags[i + 1]} ${i + 1 === tags.length - 1 ? 'END' : '.*'})`);
          const nextMatch = rules.reduce((m, rule) => m || rule.match(nextRegex), '');
          if (nextMatch) next = nextMatch[0];
          else newNext++;
        }
        const regex = new RegExp(`(?<=${prev} ${tag} )${i === tags.length - 1 ? 'END' : '.*'}`);
        let found = false;
        for (const rule of rules) {
          const match = rule.match(regex);
          if (match) {
            next = match[0];
            found = true;
            break;
          }
        }
        if (!found) {
          rules.push(`${prev} ${tag} ${next}`);
        }
        prev = next;
        i++;
      } while (i < tags.length);
    }
  }
  writeFileSync('commands.clp', commands.replace(
    '; ADD RULES HERE',
    rules.map(rule => createRule(rule)).join('\n')
  ));
}

async function testText(text) {
  const taggedSentences = tagSentences(text);
  let success = true;
  const tests = await taggedSentences.reduce(
    (promise, { sentence, tags }) => promise.then(
      async (results) => {
        const result = await runClipsCommands(tags);
        if (!result) success = false;
        return [...results, { sentence, result }];
      }), Promise.resolve([]));
  if (success) {
    console.log("Text succesfully parsed!");
  } else {
    console.log("Text parsing failed.");
    const failedTests = tests.filter(({ result }) => !result);
    console.log(`Failed to parse ${failedTests.length}/${tests.length} sentences:`);
    failedTests.forEach(failedTest => console.log(failedTest.sentence));
  }
}

(async () => {
  while (true) {
    const { action } = await inquirer
      .prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What do you want to do?',
          choices: ['Learn', 'Test', 'Exit'],
        },
      ]);
    if (action === 'Exit') {
      process.exit(0);
    }

    const { input } = await inquirer
      .prompt([
        {
          type: 'list',
          name: 'input',
          message: 'How do you want to input the text?',
          choices: ['Type', 'File'],
        },
      ]);
    let text = '';
    if (input === 'Type') {
      text = (await inquirer
        .prompt([
          {
            name: 'text',
            message: 'Enter the text:'
          },
        ])).text;
    } else if (input === 'File') {
      const { file } = await inquirer
        .prompt([
          {
            name: 'file',
            message: 'Enter the file:',
            default: './input.txt'
          },
        ]);
      text = readFileSync(file, 'utf8');
    }

    if (action === 'Learn') {
      await learnText(text);
    } else if (action === 'Test') {
      await testText(text);
    }
  }
})();


process.on('uncaughtException', err => {
  console.warn(`Uncaught Exception: ${err.message}`)
  process.exit(1)
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled rejection at ', promise, `reason: ${reason.message}`)
  process.exit(1)
});

