
from ask import retrieve
question = "LoRA"
results= retrieve(question, k=10)


found = 0
for i in results : 
    if "LoRA" in i['text'] : 
        found += 1

print(found)
