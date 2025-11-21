import joblib
import numpy as np
from openai import OpenAI

# Load PCA trained on the 680 movies
pca = joblib.load("pca_model.joblib")

# Generate embedding (1536)
response = client.embeddings.create(
    input=new_title,
    model="text-embedding-3-small"
)
emb = np.array(response.data[0].embedding)

# Reduce to 128 dims
reduced = pca.transform([emb])[0]
