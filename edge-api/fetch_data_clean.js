const { execSync } = require('child_process');
const fs = require('fs');

function fetch(command, outputFile) {
    console.log(`Fetching: ${command}`);
    const output = execSync(command, { encoding: 'utf8' });
    // Find the JSON part
    const jsonMatch = output.match(/\[\s*{\s*"results":[\s\S]*\}\s*\]/);
    if (jsonMatch) {
        const fullJson = JSON.parse(jsonMatch[0]);
        const results = fullJson[0].results;
        fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
        console.log(`Saved ${results.length} records to ${outputFile}`);
    } else {
        console.error("Failed to find JSON in output");
        console.log(output);
    }
}

fetch('npx wrangler d1 execute preschool-buffer --remote --command="SELECT id, name, parent_name, phone, birthday, class_id FROM students WHERE status = \'ACTIVE\';"', 'students.json');
fetch('npx wrangler d1 execute preschool-buffer --remote --command="SELECT id, name FROM classes;"', 'classes.json');
