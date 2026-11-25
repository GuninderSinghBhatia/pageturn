from sentence_transformers import SentenceTransformer, util
model = SentenceTransformer("all-MiniLM-L6-v2")
vector_a = model.encode("I love pizza")
vector_b = model.encode("I hate pizza")
vector_c = model.encode("I love pasta")
score_ab = util.cos_sim(vector_a, vector_b)
score_ac = util.cos_sim(vector_a, vector_c)
print("Similarity between 'I love pizza' and 'I hate pizza':", score_ab)
print("Similarity between 'I love pizza' and 'I love pasta':", score_ac)
