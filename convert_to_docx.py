from docx import Document
from htmldocx import HtmlToDocx
import markdown

def convert_md_to_docx(md_path, docx_path):
    with open(md_path, 'r', encoding='utf-8') as f:
        md_text = f.read()

    # Convert Markdown to HTML
    html = markdown.markdown(md_text, extensions=['tables'])

    # Create a new Document
    document = Document()
    
    # Init HtmlToDocx
    new_parser = HtmlToDocx()
    
    # Add HTML to docx
    new_parser.add_html_to_document(html, document)

    # Save Document
    document.save(docx_path)

if __name__ == '__main__':
    convert_md_to_docx('Project_Vidhi_Architecture_Complete.md', 'Project_Vidhi_Architecture_Complete.docx')
