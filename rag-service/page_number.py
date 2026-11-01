from langchain_community.document_loaders import PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document


def ingest_pdf(book_id : str, file_path : str) -> list:
    """
    Ingests a PDF file, splits it into chunks, and returns the chunks.
    """
    loader = PyMuPDFLoader(file_path)
    data = loader.load()
    splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=100,
    length_function=len,
    )
    clean_pages = []

    for page in data :
      document = page.page_content
      new_metadata = {"book_id": book_id, "page": page.metadata["page"] + 1}
      clean_pages.append({"document": document, "metadata": new_metadata})



    chunks = splitter.split_documents([Document(page_content=page["document"], metadata=page["metadata"]) for page in clean_pages])
    return chunks


