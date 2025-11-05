import os
from openai import OpenAI

OPENAI_PROJECT_ID = "your_project_id_here"

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    project=OPENAI_PROJECT_ID,
)


