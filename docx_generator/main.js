const docx = require('docx');
const { Document, Packer } = docx;
const fs = require('fs');

const { buildFrontMatter } = require('./front_matter.js');
const { buildPart6 } = require('./part6.js');

async function generateDoc() {
    console.log("Generating Document sections...");
    
    // We combine the sections. In Claude's architecture, we might just put them in a single document.
    const doc = new Document({
        sections: [
            {
                properties: {},
                children: [
                    ...buildFrontMatter(),
                    ...buildPart6()
                ]
            }
        ]
    });

    console.log("Packing Document into .docx file...");
    const buffer = await Packer.toBuffer(doc);
    
    fs.writeFileSync("Vidhi_Architecture_Final.docx", buffer);
    console.log("Success! Saved as Vidhi_Architecture_Final.docx");
}

generateDoc().catch(err => {
    console.error("Failed to generate document:", err);
});
