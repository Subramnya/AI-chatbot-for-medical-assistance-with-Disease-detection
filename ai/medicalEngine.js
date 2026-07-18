const crypto = require("crypto");
const { extractTextFromFile } = require("../backend/training/fileProcessor");
const { searchDocuments, normalizeText } = require("../backend/training/vectorStore");
const { buildNeuralConditionModel, predictCondition } = require("../backend/training/neuralTrainer");

const CONDITION_LIBRARY = [
  {
    key: "fracture",
    name: "Possible fracture, sprain, or soft-tissue injury",
    triggers: ["broken", "fracture", "swelling", "soiling", "deform", "fell", "fall", "injury", "pain hand", "pain leg", "unable move", "cannot move", "bruising", "bone"],
    explanation:
      "Swelling and pain after trauma can come from a fracture, dislocation, ligament sprain, tendon injury, or deep bruise. X-ray or clinician examination is needed to separate these safely.",
    terms: ["Fracture: a crack or break in a bone.", "Dislocation: a joint forced out of its normal position.", "Immobilization: keeping the injured area still to prevent further damage."],
    doNow: [
      "Rest the injured area and keep it still.",
      "Apply a cold pack wrapped in cloth for short intervals.",
      "Elevate the limb if it does not increase pain.",
      "Seek same-day medical evaluation if there is severe pain, deformity, numbness, open wound, or inability to use the limb."
    ],
    avoid: [
      "Do not massage, force movement, or try to straighten a suspected broken bone.",
      "Avoid heavy exercise, lifting, sports, and putting weight on the injured part until cleared.",
      "Avoid heat in the first day after acute swelling unless a clinician advises it."
    ],
    foodHydration: ["Eat protein-rich foods and calcium/vitamin D sources if tolerated.", "Stay hydrated; avoid alcohol when taking pain-relief medicines."],
    medicines: ["acetaminophen", "ibuprofen"]
  },
  {
    key: "cold",
    name: "Viral upper respiratory infection such as common cold",
    triggers: ["cold", "cough", "runny", "sneezing", "sore throat", "congestion", "blocked nose", "mucus", "fever", "flu"],
    explanation:
      "Cold-like symptoms are usually viral. Antibiotics do not treat ordinary viral colds, but fever, breathing trouble, chest pain, or high-risk health conditions change the urgency.",
    terms: ["Viral infection: an illness caused by a virus, not treated by antibiotics.", "Congestion: swelling and mucus that block nasal passages."],
    doNow: ["Rest, drink fluids, and use humidified air or saline spray if available.", "Monitor temperature and breathing.", "Consider testing or medical advice if flu/COVID risk is present."],
    avoid: ["Avoid unnecessary antibiotics.", "Avoid smoking and heavy exertion while feverish.", "Do not give honey to children under one year."],
    foodHydration: ["Warm fluids, soups, and soft foods can help comfort.", "Prioritize water or oral rehydration if sweating or fever is present."],
    medicines: ["acetaminophen", "ibuprofen", "saline", "cetirizine", "dextromethorphan", "guaifenesin"]
  },
  {
    key: "allergy",
    name: "Allergic reaction or irritation",
    triggers: ["allergy", "allergic", "rash", "hives", "itching", "swelling lips", "swelling face", "sneezing", "watery eyes"],
    explanation:
      "Rash, itching, hives, and sneezing can occur with allergies or irritant exposure. Breathing trouble or swelling of the lips, tongue, throat, or face can be an emergency.",
    terms: ["Hives: raised itchy welts on the skin.", "Anaphylaxis: a severe allergic reaction that can affect breathing and blood pressure."],
    doNow: ["Stop exposure to the suspected trigger if known.", "Seek urgent care for breathing difficulty, throat tightness, fainting, or facial/tongue swelling.", "Document the suspected trigger and timing."],
    avoid: ["Do not retry a medicine or food that caused severe symptoms.", "Avoid scratching irritated skin."],
    foodHydration: ["Use simple foods and fluids if nausea is present.", "Avoid suspected food triggers until reviewed."],
    medicines: ["cetirizine", "loratadine", "fexofenadine"]
  },
  {
    key: "gastro",
    name: "Vomiting, diarrhea, or gastroenteritis pattern",
    triggers: ["vomit", "vomiting", "diarrhea", "loose motion", "stomach pain", "abdominal pain", "food poisoning", "dehydration"],
    explanation:
      "Vomiting and diarrhea often need hydration first. Blood, severe pain, confusion, high fever, pregnancy, infants, older adults, or immune compromise need medical care.",
    terms: ["Dehydration: low body fluid causing thirst, dizziness, low urine, dry mouth, or weakness.", "Oral rehydration solution: balanced salts and sugar used to replace lost fluids."],
    doNow: ["Take small frequent sips of oral rehydration solution.", "Rest the stomach with bland foods when tolerated.", "Seek care if symptoms are severe, persistent, or bloody."],
    avoid: ["Avoid alcohol, greasy foods, and dehydration.", "Avoid anti-diarrhea medicines if there is high fever or bloody stool unless a clinician advises."],
    foodHydration: ["Oral rehydration solution, rice, banana, toast, curd/yogurt if tolerated.", "Return to regular food gradually."],
    medicines: ["ors", "acetaminophen"]
  },
  {
    key: "headache",
    name: "Headache or migraine-like episode",
    triggers: ["headache", "migraine", "head pain", "light sensitivity", "nausea", "aura", "forehead pain"],
    explanation:
      "Many headaches are benign, but sudden worst headache, weakness, confusion, stiff neck, fever, head injury, pregnancy, or vision loss need urgent evaluation.",
    terms: ["Migraine: recurrent headache that can cause nausea, light sensitivity, and sometimes aura.", "Aura: temporary neurologic symptoms such as visual changes before a migraine."],
    doNow: ["Rest in a quiet place, drink fluids, and note triggers.", "Seek emergency care for neurologic red flags or sudden severe onset."],
    avoid: ["Avoid alcohol, dehydration, sleep loss, and known triggers.", "Avoid repeated pain reliever use over many days without medical advice."],
    foodHydration: ["Hydrate; eat a light meal if skipped food may be a trigger.", "Limit caffeine swings if caffeine affects symptoms."],
    medicines: ["acetaminophen", "ibuprofen"]
  },
  {
    key: "wound",
    name: "Wound, bruise, or possible skin infection",
    triggers: ["cut", "wound", "pus", "redness", "warm", "infection", "bleeding", "burn", "scrape", "bite"],
    explanation:
      "Wounds need cleaning and monitoring. Increasing redness, warmth, pus, fever, red streaks, numbness, or deep/dirty wounds can mean infection or tissue injury.",
    terms: ["Cellulitis: spreading bacterial infection of the skin and soft tissue.", "Pus: thick fluid that can indicate infection."],
    doNow: ["Rinse minor wounds with clean running water and cover with a clean dressing.", "Apply direct pressure for bleeding.", "Seek care for deep, dirty, bite, burn, or infected wounds."],
    avoid: ["Do not apply harsh chemicals into deep wounds.", "Avoid picking at scabs or squeezing pus."],
    foodHydration: ["Protein, fruits, and fluids support healing.", "People with diabetes should seek earlier wound review."],
    medicines: ["acetaminophen"]
  },
  {
    key: "chest",
    name: "Chest pain or breathing-risk presentation",
    triggers: ["chest pain", "pressure chest", "shortness breath", "breathing difficulty", "sweating", "left arm pain", "jaw pain", "fainting", "palpitation"],
    explanation:
      "Chest pressure, shortness of breath, fainting, sweating, or pain spreading to the arm, jaw, shoulder, or back can be signs of a heart or lung emergency.",
    terms: ["Cardiac: related to the heart.", "Dyspnea: difficulty breathing."],
    doNow: ["Call local emergency services now if symptoms are active or severe.", "Sit upright and avoid driving yourself.", "Keep a list of current medicines ready for responders."],
    avoid: ["Do not exercise through chest pain.", "Do not delay emergency care to try home remedies."],
    foodHydration: ["Do not eat a heavy meal during active severe chest symptoms.", "Follow clinician advice once evaluated."],
    medicines: []
  }
];

CONDITION_LIBRARY.push(
  {
    key: "asthma",
    name: "Asthma flare or wheezing episode",
    triggers: ["asthma", "wheezing", "whistle breath", "tight chest", "inhaler", "breathless", "shortness breath at night"],
    explanation:
      "Wheezing, chest tightness, cough, and breathlessness can occur when airways narrow during an asthma flare. Severe breathing difficulty is urgent.",
    terms: ["Wheezing: a whistling sound from narrowed airways.", "Bronchospasm: tightening of airway muscles.", "Reliever inhaler: a clinician-prescribed medicine used for quick symptom relief."],
    doNow: ["Sit upright and avoid triggers such as smoke, dust, strong smells, or cold air.", "Use a prescribed asthma action plan or prescribed reliever inhaler if you already have one.", "Seek urgent care for severe breathlessness, blue lips, exhaustion, confusion, or poor response to prescribed reliever medicine."],
    avoid: ["Do not ignore worsening breathing symptoms.", "Avoid smoke, heavy exercise during active symptoms, and unprescribed inhalers."],
    foodHydration: ["Drink fluids as tolerated.", "Avoid foods only if they are known personal triggers."],
    medicines: []
  },
  {
    key: "pneumonia",
    name: "Possible pneumonia or lower respiratory infection",
    triggers: ["pneumonia", "cough with fever", "phlegm", "chills", "chest infection", "breathing fast", "coughing blood"],
    explanation:
      "Fever, cough, chills, chest discomfort, and breathing difficulty can come from pneumonia or another lower respiratory infection. Diagnosis may require examination, oxygen level, and chest imaging.",
    terms: ["Pneumonia: infection or inflammation in the air sacs of the lungs.", "Oxygen saturation: the amount of oxygen carried in the blood."],
    doNow: ["Seek medical evaluation if cough comes with fever, fast breathing, chest pain, low oxygen, older age, pregnancy, or immune compromise.", "Rest, hydrate, and monitor breathing and temperature."],
    avoid: ["Avoid self-starting antibiotics without evaluation.", "Avoid smoking and heavy exertion."],
    foodHydration: ["Warm fluids and balanced food can support recovery.", "Small frequent fluids help if appetite is low."],
    medicines: ["acetaminophen"]
  },
  {
    key: "uti",
    name: "Urinary tract infection pattern",
    triggers: ["urine burning", "burning urination", "uti", "urinary tract", "frequent urination", "urgency urine", "lower belly pain", "blood in urine"],
    explanation:
      "Burning urination, frequency, urgency, lower abdominal pain, or blood in urine can suggest a urinary tract infection. Fever, back pain, pregnancy, or kidney disease raises urgency.",
    terms: ["Dysuria: pain or burning while urinating.", "Urinalysis: a urine test used to look for infection signs."],
    doNow: ["Drink fluids unless a clinician has restricted fluids.", "Seek medical advice for urine testing and treatment, especially with fever, flank pain, pregnancy, male sex, diabetes, or recurrent symptoms."],
    avoid: ["Avoid delaying care if fever, back pain, vomiting, or pregnancy is present.", "Avoid using leftover antibiotics."],
    foodHydration: ["Hydration can help comfort but does not replace care when infection is likely.", "Avoid bladder irritants such as alcohol or excess caffeine if they worsen symptoms."],
    medicines: ["acetaminophen"]
  },
  {
    key: "diabetes",
    name: "Blood sugar concern: high or low glucose symptoms",
    triggers: ["diabetes", "high sugar", "low sugar", "blood sugar", "frequent urination", "excessive thirst", "shaky", "sweating", "hypoglycemia", "hyperglycemia"],
    explanation:
      "Very high or very low blood sugar can cause serious symptoms. Diabetes symptoms can include thirst, frequent urination, fatigue, blurred vision, sweating, shakiness, confusion, or weakness.",
    terms: ["Hypoglycemia: blood sugar that is too low.", "Hyperglycemia: blood sugar that is too high.", "Ketones: acids that can build up when the body lacks insulin."],
    doNow: ["Check blood glucose if a meter or sensor is available.", "For known diabetes, follow the personal clinician-provided sick-day or low-sugar plan.", "Seek urgent care for confusion, fainting, vomiting, deep breathing, severe weakness, or very high readings with ketones."],
    avoid: ["Do not stop insulin or diabetes medicines without clinician advice.", "Avoid driving during suspected low blood sugar."],
    foodHydration: ["Use fast sugar only for suspected or measured low blood sugar if the person can swallow safely.", "Hydrate during high sugar unless fluid restriction exists."],
    medicines: []
  },
  {
    key: "hypertension",
    name: "High blood pressure or hypertensive warning signs",
    triggers: ["high blood pressure", "hypertension", "bp high", "blood pressure high", "severe headache with bp", "blurred vision bp"],
    explanation:
      "High blood pressure often has no symptoms, but very high readings with chest pain, breathing difficulty, neurologic symptoms, severe headache, or vision changes can be an emergency.",
    terms: ["Hypertension: blood pressure that stays higher than healthy ranges.", "Hypertensive emergency: very high blood pressure with possible organ damage symptoms."],
    doNow: ["Recheck blood pressure after resting quietly if safe.", "Seek emergency care for chest pain, shortness of breath, weakness, confusion, severe headache, or vision change with very high blood pressure.", "Contact a clinician for repeated high readings."],
    avoid: ["Do not double prescribed blood pressure medicines without clinician advice.", "Avoid heavy exercise during severe symptoms."],
    foodHydration: ["Limit excess salt and alcohol if blood pressure is high.", "Hydrate normally unless a clinician has restricted fluids."],
    medicines: []
  },
  {
    key: "back-pain",
    name: "Back strain, nerve irritation, or spine red-flag pattern",
    triggers: ["back pain", "lower back", "sciatica", "leg numbness", "shooting pain", "back injury", "cannot pass urine"],
    explanation:
      "Back pain often comes from muscle strain or nerve irritation. Weakness, numbness in the groin area, loss of bladder/bowel control, fever, cancer history, or major trauma needs urgent care.",
    terms: ["Sciatica: pain traveling along the sciatic nerve, often down the leg.", "Radiculopathy: nerve-root irritation causing pain, numbness, or weakness."],
    doNow: ["Keep gentle movement as tolerated for simple strain.", "Use heat or cold for comfort depending on what helps.", "Seek urgent care for bladder/bowel changes, leg weakness, numbness in the groin, fever, or major trauma."],
    avoid: ["Avoid bed rest for many days unless instructed.", "Avoid heavy lifting and twisting during acute pain."],
    foodHydration: ["Balanced food and hydration support recovery.", "Avoid alcohol if taking pain-relief medicines."],
    medicines: ["acetaminophen", "ibuprofen"]
  },
  {
    key: "anxiety",
    name: "Anxiety or panic-like symptoms",
    triggers: ["anxiety", "panic", "heart racing", "fear", "hyperventilating", "tingling hands", "panic attack"],
    explanation:
      "Panic and anxiety can cause racing heart, chest tightness, fast breathing, tingling, dizziness, and fear. Similar symptoms can also occur with heart, lung, thyroid, medicine, or blood sugar problems.",
    terms: ["Panic attack: sudden intense fear with physical symptoms.", "Hyperventilation: breathing faster or deeper than needed."],
    doNow: ["Slow breathing, grounding, and moving to a safe quiet place can help if symptoms match previous panic episodes.", "Seek urgent care if symptoms are new, severe, include chest pain, fainting, or breathing difficulty."],
    avoid: ["Avoid assuming chest pain is anxiety if it is new or severe.", "Avoid alcohol or recreational drugs to control symptoms."],
    foodHydration: ["Limit caffeine if it worsens anxiety.", "Eat regular meals if low blood sugar triggers symptoms."],
    medicines: []
  },
  {
    key: "depression",
    name: "Depression or low mood concern",
    triggers: ["depression", "depressed", "hopeless", "no interest", "suicidal", "self harm", "want to die"],
    explanation:
      "Persistent low mood, loss of interest, sleep/appetite changes, guilt, low energy, poor concentration, or thoughts of self-harm can occur with depression and deserve support.",
    terms: ["Anhedonia: loss of interest or pleasure.", "Suicidal ideation: thoughts about ending one's life."],
    doNow: ["If there are thoughts of self-harm or suicide, contact emergency services or a crisis line now.", "Reach out to a trusted person and arrange professional mental health support."],
    avoid: ["Do not stay alone during active self-harm risk.", "Avoid alcohol or drugs when mood is unsafe."],
    foodHydration: ["Regular meals, hydration, sleep routine, and gentle movement can support care but do not replace treatment."],
    medicines: []
  },
  {
    key: "anemia",
    name: "Anemia or low blood count concern",
    triggers: ["anemia", "anaemia", "tired", "fatigue", "pale", "dizzy", "dizziness", "short breath on exertion", "heavy periods", "low hemoglobin"],
    explanation:
      "Anemia means the body may not have enough healthy red blood cells or hemoglobin. Causes include iron deficiency, blood loss, vitamin deficiency, chronic disease, and other conditions.",
    terms: ["Hemoglobin: the oxygen-carrying protein in red blood cells.", "Iron deficiency: low iron stores that can reduce hemoglobin production."],
    doNow: ["Discuss blood testing with a clinician if fatigue, pallor, dizziness, heavy bleeding, or shortness of breath persists.", "Seek urgent care for fainting, chest pain, severe breathlessness, or heavy bleeding."],
    avoid: ["Avoid starting high-dose iron without knowing the cause.", "Avoid ignoring black stools or heavy bleeding."],
    foodHydration: ["Iron-rich foods include beans, lentils, leafy greens, meat, and fortified foods.", "Vitamin C with meals can improve non-heme iron absorption."],
    medicines: []
  },
  {
    key: "dizziness",
    name: "Dizziness, vertigo, or lightheadedness pattern",
    triggers: ["dizzy", "dizziness", "vertigo", "lightheaded", "light headed", "room spinning", "balance problem", "unsteady", "near faint", "almost faint", "faint feeling"],
    explanation:
      "Dizziness can come from dehydration, inner ear balance problems, low blood sugar, blood pressure changes, anemia, medicines, anxiety, or heart and neurologic causes. The safest next step depends on timing, triggers, severity, and warning signs.",
    terms: ["Vertigo: a spinning or moving sensation.", "Lightheadedness: feeling faint or close to passing out.", "Balance problem: unsteadiness while standing or walking."],
    doNow: [
      "Sit or lie down until the dizziness settles and avoid driving or climbing.",
      "Note when it started, how long it lasts, triggers, medicines, hydration, fever, headache, chest pain, weakness, numbness, or fainting.",
      "Seek same-day medical advice if dizziness is new, repeated, severe, follows injury, or comes with fainting, chest pain, shortness of breath, weakness, numbness, severe headache, confusion, or vision changes."
    ],
    avoid: ["Do not drive, operate machinery, or stand on heights during dizziness.", "Do not ignore dizziness with chest pain, fainting, one-sided weakness, severe headache, or breathing difficulty."],
    foodHydration: ["Sip fluids if awake and able to swallow safely.", "Eat a light snack if low food intake may be contributing, unless vomiting or clinician restrictions apply."],
    medicines: []
  },
  {
    key: "sinusitis",
    name: "Sinus congestion or sinusitis pattern",
    triggers: ["sinus", "sinusitis", "face pain", "forehead pressure", "blocked nose", "post nasal", "thick nasal"],
    explanation:
      "Sinus pressure, nasal blockage, thick discharge, and facial pain can come from viral infection, allergies, or bacterial sinusitis. Duration and severity matter.",
    terms: ["Sinuses: air-filled spaces around the nose and eyes.", "Postnasal drip: mucus draining from the nose into the throat."],
    doNow: ["Use saline spray or gentle steam/humidified air for comfort.", "Seek care for severe facial swelling, vision changes, high fever, or symptoms lasting/worsening beyond expected cold duration."],
    avoid: ["Avoid unnecessary antibiotics for short viral symptoms.", "Avoid smoke and strong irritants."],
    foodHydration: ["Warm fluids can help comfort.", "Hydration may thin mucus."],
    medicines: ["acetaminophen", "ibuprofen", "saline", "cetirizine", "loratadine"]
  },
  {
    key: "ear-infection",
    name: "Ear infection or ear pain pattern",
    triggers: ["ear pain", "ear infection", "ear discharge", "hearing reduced", "earache", "fluid ear"],
    explanation:
      "Ear pain can come from middle ear infection, outer ear infection, wax, injury, jaw problems, or referred throat pain. Fever, discharge, severe pain, or hearing change needs review.",
    terms: ["Otitis media: middle ear infection.", "Otitis externa: outer ear canal infection."],
    doNow: ["Seek clinician advice for severe pain, fever, ear discharge, swelling, hearing loss, or symptoms in young children.", "Keep the ear dry if discharge or outer ear infection is suspected."],
    avoid: ["Do not insert cotton swabs or objects into the ear canal.", "Avoid ear drops if the eardrum may be damaged unless advised."],
    foodHydration: ["Normal food and fluids as tolerated.", "Warm fluids can soothe associated throat symptoms."],
    medicines: ["acetaminophen", "ibuprofen"]
  },
  {
    key: "conjunctivitis",
    name: "Conjunctivitis or eye irritation",
    triggers: ["pink eye", "conjunctivitis", "red eye", "eye discharge", "itchy eye", "watery eye", "eye crust"],
    explanation:
      "Red or irritated eyes can come from viral conjunctivitis, bacterial infection, allergy, dryness, injury, or contact lens problems. Pain, vision change, light sensitivity, or injury needs urgent care.",
    terms: ["Conjunctiva: thin membrane covering the white of the eye.", "Photophobia: light sensitivity."],
    doNow: ["Wash hands and avoid sharing towels.", "Stop contact lens use until reviewed if lenses are involved.", "Seek urgent care for eye pain, vision changes, injury, severe light sensitivity, or chemical exposure."],
    avoid: ["Avoid rubbing the eye.", "Avoid steroid eye drops unless prescribed."],
    foodHydration: ["Hydration and rest can support comfort.", "Avoid known allergy triggers if itchy watery eyes are allergy-related."],
    medicines: []
  },
  {
    key: "gerd",
    name: "Heartburn, reflux, or gastritis-like symptoms",
    triggers: ["heartburn", "acid reflux", "gerd", "burning chest after food", "sour taste", "indigestion", "gastritis"],
    explanation:
      "Burning after meals, sour taste, burping, and upper abdominal discomfort can come from reflux or gastritis. Chest pain must be treated carefully because heart symptoms can mimic indigestion.",
    terms: ["GERD: gastroesophageal reflux disease, where stomach acid flows back into the esophagus.", "Gastritis: inflammation of the stomach lining."],
    doNow: ["Eat smaller meals and stay upright after eating.", "Seek urgent care if chest pain is crushing, spreads to arm/jaw/back, or comes with sweating, breathlessness, or fainting.", "Discuss persistent symptoms, trouble swallowing, weight loss, vomiting blood, or black stools with a clinician."],
    avoid: ["Avoid late heavy meals, alcohol, smoking, and trigger foods that worsen symptoms.", "Avoid NSAIDs if they worsen stomach pain or bleeding risk exists."],
    foodHydration: ["Choose smaller, less spicy, less fatty meals if those trigger symptoms.", "Water is usually better than alcohol or excess caffeine."],
    medicines: ["antacid"]
  },
  {
    key: "dehydration",
    name: "Dehydration or heat illness concern",
    triggers: ["dehydrated", "dehydration", "very thirsty", "no urine", "dark urine", "heat exhaustion", "dizzy in heat"],
    explanation:
      "Low body fluid can cause thirst, dizziness, dry mouth, dark urine, weakness, confusion, or low urination. Heat illness can become dangerous quickly.",
    terms: ["Dehydration: loss of more fluid than the body takes in.", "Heat exhaustion: heat-related illness with weakness, sweating, dizziness, or nausea."],
    doNow: ["Move to a cool place and sip oral rehydration solution or fluids if able to swallow.", "Seek urgent care for confusion, fainting, inability to drink, no urination, severe weakness, or heat stroke signs."],
    avoid: ["Avoid alcohol and heavy exertion during heat illness.", "Avoid forcing fluids if the person is confused or cannot swallow safely."],
    foodHydration: ["Use oral rehydration solution for vomiting, diarrhea, heavy sweating, or heat exposure.", "Small frequent sips may be easier than large amounts."],
    medicines: ["ors"]
  },
  {
    key: "covid",
    name: "COVID-19, flu, or viral respiratory illness pattern",
    triggers: ["covid", "coronavirus", "loss of smell", "loss of taste", "body aches", "viral fever", "flu like", "sore throat fever"],
    explanation:
      "Fever, cough, sore throat, body aches, fatigue, and loss of smell/taste can occur with COVID-19, flu, or other viral respiratory infections. Risk level depends on breathing, oxygen, age, pregnancy, and medical conditions.",
    terms: ["Isolation: reducing contact with others while contagious.", "Antiviral: medicine that targets viruses and is prescribed only for selected patients."],
    doNow: ["Consider testing according to local guidance.", "Rest, hydrate, and monitor breathing.", "Seek urgent care for breathing difficulty, chest pain, confusion, blue lips, dehydration, or low oxygen."],
    avoid: ["Avoid exposing others while feverish or actively infectious.", "Avoid antibiotics unless a clinician suspects bacterial infection."],
    foodHydration: ["Fluids, soups, and light food can help during fever.", "Oral rehydration helps if sweating or poor intake is present."],
    medicines: ["acetaminophen", "ibuprofen"]
  }
);

const MEDICINE_LIBRARY = {
  acetaminophen: {
    purpose: "Pain or fever",
    medicineName: "Paracetamol / Acetaminophen",
    activeContent: "Paracetamol, also called acetaminophen",
    commonBrands: ["Tylenol", "Calpol", "Dolo 650", "Crocin"],
    reviewWindow: "Short-term only, usually 1 to 3 days before clinician review if symptoms continue.",
    safety: "Avoid or ask first with liver disease, heavy alcohol use, allergy, or another product containing paracetamol/acetaminophen."
  },
  ibuprofen: {
    purpose: "Pain, swelling, or fever",
    medicineName: "Ibuprofen",
    activeContent: "Ibuprofen, a nonsteroidal anti-inflammatory drug (NSAID)",
    commonBrands: ["Advil", "Motrin", "Brufen", "Ibugesic"],
    reviewWindow: "Short-term only, usually 1 to 2 days for swelling/pain before clinician review if not improving.",
    safety: "Avoid or ask first with NSAID allergy, stomach ulcer/bleeding, kidney disease, blood thinners, uncontrolled blood pressure, heart disease, pregnancy, or dehydration."
  },
  cetirizine: {
    purpose: "Allergy symptoms",
    medicineName: "Cetirizine",
    activeContent: "Cetirizine hydrochloride, second-generation antihistamine",
    commonBrands: ["Zyrtec", "Cetzine", "Okacet", "Alerid"],
    reviewWindow: "Often used short-term for 1 to 3 days for simple allergy symptoms; review if symptoms persist or worsen.",
    safety: "Can cause drowsiness in some people. Ask a clinician for young children, pregnancy, kidney disease, or complex medicine lists."
  },
  loratadine: {
    purpose: "Allergy symptoms",
    medicineName: "Loratadine",
    activeContent: "Loratadine, second-generation antihistamine",
    commonBrands: ["Claritin", "Lorfast", "Alavert"],
    reviewWindow: "Short-term allergy support for 1 to 3 days; review if symptoms persist, rash spreads, or breathing symptoms occur.",
    safety: "Ask a clinician first for pregnancy, liver disease, young children, severe allergy, or complex medicine lists."
  },
  fexofenadine: {
    purpose: "Allergy symptoms",
    medicineName: "Fexofenadine",
    activeContent: "Fexofenadine hydrochloride, second-generation antihistamine",
    commonBrands: ["Allegra", "Fexova", "Telfast"],
    reviewWindow: "Short-term allergy support for 1 to 3 days; review if symptoms persist or worsen.",
    safety: "Ask a clinician first for kidney disease, pregnancy, young children, severe allergy, or complex medicine lists."
  },
  saline: {
    purpose: "Nasal congestion",
    medicineName: "Sterile saline nasal spray/drops",
    activeContent: "Sodium chloride sterile saline",
    commonBrands: ["Simply Saline", "Nasoclear", "generic saline"],
    reviewWindow: "Can be used for a few days as comfort support; review if severe or prolonged symptoms.",
    safety: "Use clean sterile products and avoid sharing bottles."
  },
  ors: {
    purpose: "Dehydration",
    medicineName: "Oral rehydration solution",
    activeContent: "Glucose and electrolytes such as sodium and potassium salts",
    commonBrands: ["Pedialyte", "Electral", "WHO ORS"],
    reviewWindow: "Use during fluid loss and seek care if dehydration signs are severe or persistent.",
    safety: "Seek care for severe dehydration, infants, older adults, kidney disease, persistent vomiting, confusion, or blood in stool."
  },
  antacid: {
    purpose: "Simple heartburn",
    medicineName: "Antacid",
    activeContent: "Examples include calcium carbonate, magnesium hydroxide, or aluminium hydroxide combinations",
    commonBrands: ["Tums", "Gelusil", "Digene"],
    reviewWindow: "Short-term, usually 1 to 2 days for simple heartburn before review if symptoms continue.",
    safety: "Do not use to cover up severe chest pain, black stools, vomiting blood, trouble swallowing, kidney disease, or persistent symptoms."
  },
  dextromethorphan: {
    purpose: "Dry cough",
    medicineName: "Dextromethorphan",
    activeContent: "Dextromethorphan hydrobromide cough suppressant",
    commonBrands: ["Delsym", "Benadryl DR", "Corex DX"],
    reviewWindow: "Short-term only for dry cough; review if cough lasts, fever is high, breathing is difficult, or phlegm is bloody.",
    safety: "Avoid with MAOI medicines or some antidepressants unless a clinician/pharmacist confirms safety."
  },
  guaifenesin: {
    purpose: "Thick mucus cough",
    medicineName: "Guaifenesin",
    activeContent: "Guaifenesin expectorant",
    commonBrands: ["Mucinex", "Benadryl CR", "guaifenesin generics"],
    reviewWindow: "Short-term support for mucus cough; review if fever, shortness of breath, chest pain, or symptoms persist.",
    safety: "Check combination cough syrups carefully to avoid duplicate ingredients."
  }
};

const RED_FLAGS = [
  { pattern: /chest\s*(pain|pressure)|left arm pain|jaw pain/i, reason: "Chest pain or pressure can be an emergency." },
  { pattern: /short(ness)?\s*of\s*breath|breathing difficulty|cannot breathe/i, reason: "Breathing difficulty requires urgent evaluation." },
  { pattern: /face droop|slurred speech|weakness on one side|stroke/i, reason: "Stroke-like symptoms require emergency care." },
  { pattern: /unconscious|fainting|seizure|confusion/i, reason: "Loss of consciousness, seizure, or confusion can signal serious illness." },
  { pattern: /bone.*(out|visible)|open fracture|heavy bleeding|blood spurting/i, reason: "Open fracture or heavy bleeding needs emergency care." },
  { pattern: /swelling.*(tongue|throat|lips|face)|throat tight|anaphylaxis/i, reason: "Airway swelling or anaphylaxis symptoms are emergency warning signs." },
  { pattern: /worst headache|sudden severe headache|stiff neck/i, reason: "Sudden severe headache or stiff neck can be urgent." },
  { pattern: /black stool|vomiting blood|blood in stool/i, reason: "Possible internal bleeding or serious infection needs medical review." },
  { pattern: /suicidal|self harm|want to die|kill myself/i, reason: "Self-harm or suicide thoughts require immediate support." },
  { pattern: /loss of bladder|loss of bowel|numbness.*groin|cannot pass urine/i, reason: "Back pain with bladder, bowel, or groin numbness symptoms can be urgent." },
  { pattern: /eye pain|vision loss|chemical.*eye/i, reason: "Eye pain, vision loss, or chemical exposure needs urgent eye care." },
  { pattern: /no urine|confusion.*dehydrat|heat stroke/i, reason: "Severe dehydration or heat illness can become an emergency." }
];

const SOON_FLAGS = [
  { pattern: /dizz(?:y|iness)|vertigo|light[- ]?headed|near faint|almost faint|faint feeling/i, reason: "Dizziness or near-fainting should be reviewed soon if it is new, repeated, severe, or affecting balance." },
  { pattern: /severe|worsening|high fever|unable|cannot move|deform|pregnan|infant|elderly/i, reason: "Symptoms include severity or risk words. Same-day medical advice is safer." },
  { pattern: /persistent vomiting|blood in urine|blood in stool|coughing blood|palpitation|heart racing/i, reason: "The symptoms include warning terms that deserve medical review soon." }
];

let neuralModelCache = { fingerprint: "", model: null };

function conditionKey(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function conditionTrainingText(condition) {
  return normalizeText(
    [
      condition.name,
      ...(condition.triggers || []),
      condition.explanation,
      ...(condition.terms || []),
      ...(condition.avoid || []),
      ...(condition.foodHydration || [])
    ].join(" ")
  );
}

function diseaseDocumentTrainingText(doc) {
  return normalizeText(
    [
      doc.metadata?.diseaseName || doc.title,
      ...(doc.metadata?.symptoms || []),
      doc.metadata?.description || "",
      doc.text
    ].join(" ")
  );
}

function neuralFingerprint(documents = []) {
  return documents
    .filter((doc) => doc.metadata?.datasetDisease)
    .map((doc) => `${doc.id}:${doc.tokenCount || 0}`)
    .sort()
    .join("|");
}

function getNeuralConditionModel(documents = []) {
  const fingerprint = neuralFingerprint(documents);
  if (neuralModelCache.fingerprint === fingerprint && neuralModelCache.model) return neuralModelCache.model;

  const examples = CONDITION_LIBRARY.map((condition) => ({
    key: condition.key,
    label: condition.name,
    text: conditionTrainingText(condition)
  }));

  for (const doc of documents) {
    if (!doc.metadata?.datasetDisease) continue;
    examples.push({
      key: `dataset-${conditionKey(doc.metadata.diseaseName || doc.title)}`,
      label: doc.metadata.diseaseName || doc.title,
      text: diseaseDocumentTrainingText(doc)
    });
  }

  neuralModelCache = {
    fingerprint,
    model: buildNeuralConditionModel(examples)
  };
  return neuralModelCache.model;
}

function extractMatchedSymptoms(text, symptoms = []) {
  const lower = text.toLowerCase();
  return symptoms
    .filter((symptom) => {
      const readable = normalizeText(symptom).toLowerCase();
      const compact = readable.replace(/\s+/g, "_");
      return lower.includes(readable) || lower.includes(compact);
    })
    .slice(0, 5);
}

function firstSentence(text = "") {
  return normalizeText(text).split(/(?<=[.!?])\s+/)[0] || normalizeText(text).slice(0, 220);
}

function conditionFromDiseaseDocument(doc, text, neuralProbability = 0) {
  const diseaseName = doc.metadata?.diseaseName || doc.title.replace(/\s+imported disease profile$/i, "");
  const matchedSymptoms = extractMatchedSymptoms(text, doc.metadata?.symptoms || []);
  return {
    key: `dataset-${conditionKey(diseaseName)}`,
    name: `${diseaseName} pattern`,
    score: Math.max(1, Math.round((doc.score || neuralProbability) * 10)),
    neuralProbability,
    explanation: firstSentence(doc.text) || "This imported disease profile matched the symptoms in local training data.",
    evidence: matchedSymptoms.length
      ? matchedSymptoms.map((symptom) => `Input matched imported symptom ${symptom}`)
      : [`Imported disease profile matched local vector search score ${doc.score || neuralProbability}`],
    terms: [`${diseaseName}: imported disease profile from the local dataset.`],
    doNow: ["Use the report as a discussion aid and confirm the diagnosis with a qualified clinician."],
    avoid: [
      `Do not assume ${diseaseName} is confirmed from symptoms alone.`,
      "Do not self-start antibiotics, steroids, antivirals, or prescription medicines without clinician advice.",
      "Do not delay urgent care if symptoms are severe, worsening, or include red flags."
    ],
    foodHydration: ["Use normal food and fluids as tolerated unless vomiting, diarrhea, dehydration, or a clinician restriction is present."],
    medicines: []
  };
}

function datasetConditionsFromKnowledge(text, knowledge = [], neuralPredictions = []) {
  const neuralByKey = new Map(neuralPredictions.map((prediction) => [prediction.key, prediction.probability]));
  return knowledge
    .filter((doc) => doc.metadata?.datasetDisease)
    .filter((doc) => {
      const matchedSymptoms = extractMatchedSymptoms(text, doc.metadata?.symptoms || []);
      const key = `dataset-${conditionKey(doc.metadata?.diseaseName || doc.title)}`;
      return (doc.score || 0) >= 0.14 || matchedSymptoms.length >= 2 || (neuralByKey.get(key) || 0) >= 0.24;
    })
    .map((doc) => {
      const key = `dataset-${conditionKey(doc.metadata?.diseaseName || doc.title)}`;
      return conditionFromDiseaseDocument(doc, text, neuralByKey.get(key) || 0);
    });
}

function conditionsFromNeuralPredictions(text, documents = [], predictions = []) {
  const datasetDocsByKey = new Map(
    documents
      .filter((doc) => doc.metadata?.datasetDisease)
      .map((doc) => [`dataset-${conditionKey(doc.metadata?.diseaseName || doc.title)}`, doc])
  );
  const staticByKey = new Map(CONDITION_LIBRARY.map((condition) => [condition.key, condition]));
  const candidates = [];

  for (const prediction of predictions) {
    if (prediction.probability < 0.18) continue;
    const staticCondition = staticByKey.get(prediction.key);
    if (staticCondition) {
      candidates.push({
        ...staticCondition,
        score: Math.max(1, Math.round(prediction.probability * 8)),
        neuralProbability: prediction.probability,
        evidence: [`Forward/backward propagation model matched ${prediction.label}`]
      });
      continue;
    }

    const datasetDoc = datasetDocsByKey.get(prediction.key);
    if (datasetDoc) candidates.push(conditionFromDiseaseDocument(datasetDoc, text, prediction.probability));
  }

  return candidates;
}

function conditionMergeTokens(condition = {}) {
  return [
    condition.key,
    conditionKey(condition.name),
    conditionKey(condition.name).replace(/-pattern$/i, ""),
    condition.key?.replace(/^dataset-/i, "")
  ]
    .filter(Boolean)
    .map((value) => value.replace(/^-+|-+$/g, ""))
    .filter((value) => value.length >= 4);
}

function findMergeKey(condition, merged) {
  const incomingTokens = conditionMergeTokens(condition);
  for (const [existingKey, existing] of merged.entries()) {
    const existingTokens = conditionMergeTokens({ ...existing, key: existingKey });
    const overlaps = incomingTokens.some((incoming) =>
      existingTokens.some(
        (existingToken) =>
          incoming === existingToken ||
          (incoming.length >= 5 && existingToken.includes(incoming)) ||
          (existingToken.length >= 5 && incoming.includes(existingToken))
      )
    );
    if (overlaps) return existingKey;
  }
  return condition.key || conditionKey(condition.name);
}

function mergeConditionCandidates(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const condition of group) {
      const key = findMergeKey(condition, merged);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          ...condition,
          evidence: [...new Set(condition.evidence || [])]
        });
        continue;
      }
      existing.score = Math.max(existing.score || 0, condition.score || 0);
      existing.neuralProbability = Math.max(existing.neuralProbability || 0, condition.neuralProbability || 0);
      existing.evidence = [...new Set([...(existing.evidence || []), ...(condition.evidence || [])])];
    }
  }

  return [...merged.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.neuralProbability || 0) - (a.neuralProbability || 0))
    .slice(0, 2);
}

function trimWeakConditionCandidates(candidates = []) {
  if (candidates.length < 2) return candidates;
  const [top, ...rest] = candidates;
  if ((top.score || 0) < 3) return candidates;
  return [top, ...rest.filter((condition) => (condition.score || 0) >= 2 || (condition.neuralProbability || 0) >= 0.3)].slice(0, 2);
}

function conditionConfidence(condition = {}) {
  if ((condition.score || 0) >= 4 || (condition.neuralProbability || 0) >= 0.55) return "medium";
  if ((condition.score || 0) >= 2 || (condition.neuralProbability || 0) >= 0.28) return "low-to-medium";
  return "low";
}

function formatEvidence(item = "") {
  return /^(input matched|imported|forward\/backward)/i.test(item) ? item : `Input matched ${item}`;
}

function safeAge(age) {
  const parsed = Number.parseInt(age, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function combinedIntakeText(intake = {}) {
  const fileTexts = (intake.files || [])
    .map((file) => {
      try {
        return extractTextFromFile(file).text;
      } catch {
        return "";
      }
    })
    .join(" ");

  return normalizeText(
    [
      intake.name,
      intake.age,
      intake.sex,
      intake.symptoms,
      intake.visuals,
      intake.allergies,
      intake.currentMedicines,
      intake.reportsDescription,
      intake.additional,
      fileTexts
    ].join(" ")
  );
}

function detectUrgency(text) {
  const reasons = RED_FLAGS.filter((flag) => flag.pattern.test(text)).map((flag) => flag.reason);
  if (reasons.length) return { level: "Emergency", reasons };
  const soonReasons = SOON_FLAGS.filter((flag) => flag.pattern.test(text)).map((flag) => flag.reason);
  if (soonReasons.length) return { level: "Soon", reasons: soonReasons };
  return {
    level: "Mild / routine monitoring",
    reasons: ["No emergency red-flag phrase was detected in the provided text."]
  };
}

function scoreConditions(text) {
  const lower = text.toLowerCase();
  return CONDITION_LIBRARY.map((condition) => {
    const evidence = condition.triggers.filter((trigger) => lower.includes(trigger));
    return {
      ...condition,
      score: evidence.length,
      evidence
    };
  })
    .filter((condition) => condition.score > 0)
    .sort((a, b) => b.score - a.score);
}

function medicineAllowed(key, intake = {}) {
  const allText = combinedIntakeText(intake).toLowerCase();
  const age = safeAge(intake.age);
  if (new RegExp(`allerg[^.]{0,40}${key}|${key}[^.]{0,40}allerg`, "i").test(allText)) return false;
  if (key === "ibuprofen" && /(nsaid|ibuprofen|naproxen|ulcer|kidney|blood thinner|warfarin|pregnan|heart disease)/i.test(allText)) return false;
  if (key === "acetaminophen" && /(paracetamol allergy|acetaminophen allergy|liver disease|heavy alcohol)/i.test(allText)) return false;
  if (["cetirizine", "loratadine", "fexofenadine"].includes(key) && age !== null && age < 2) return false;
  if (key === "antacid" && /(kidney disease|black stool|vomiting blood|chest pain)/i.test(allText)) return false;
  if (key === "dextromethorphan" && /(antidepressant|maoi|sertraline|fluoxetine|paroxetine|escitalopram|productive cough|blood in sputum)/i.test(allText)) return false;
  return true;
}

function symptomDecisionText(intake = {}) {
  return normalizeText([intake.symptoms, intake.visuals, intake.reportsDescription, intake.additional].join(" ")).toLowerCase();
}

function medicineFitsSymptoms(key, intake = {}, condition = {}) {
  const text = symptomDecisionText(intake);
  const conditionText = `${condition.key || ""} ${condition.name || ""}`.toLowerCase();
  if (key === "acetaminophen") return /fever|temperature|pain|ache|headache|migraine|sore throat|body ache|injury|swelling/.test(text);
  if (key === "ibuprofen") return /swelling|sprain|injury|fracture|pain|headache|migraine|fever/.test(text) && !/cold only|mild cold/.test(text);
  if (key === "saline") return /cold|runny|blocked|stuffy|congestion|sinus|sneez|nose|nasal/.test(text) || /cold|sinus/.test(conditionText);
  if (["cetirizine", "loratadine", "fexofenadine"].includes(key)) {
    return /allerg|itch|hives|rash|sneez|watery|runny nose/.test(text) || /allerg/.test(conditionText);
  }
  if (key === "dextromethorphan") return /dry cough|cough dry|non productive cough/.test(text);
  if (key === "guaifenesin") return /phlegm|mucus|productive cough|wet cough|thick sputum/.test(text);
  if (key === "ors") return /vomit|diarrhea|loose motion|dehydrat|heat exhaustion|sweating/.test(text);
  if (key === "antacid") return /heartburn|reflux|acid|sour taste|indigestion|gastritis/.test(text) || /gerd/.test(conditionText);
  return true;
}

function medicineClass(key) {
  if (["cetirizine", "loratadine", "fexofenadine"].includes(key)) return "antihistamine";
  if (["dextromethorphan", "guaifenesin"].includes(key)) return "cough";
  return key;
}

function buildSummary(intake, text, files) {
  const summary = [];
  if (intake.symptoms) summary.push(`Main symptoms: ${intake.symptoms}`);
  if (intake.visuals) summary.push(`Visible changes described: ${intake.visuals}`);
  if (intake.age) summary.push(`Age provided: ${intake.age}`);
  if (intake.allergies) summary.push(`Allergies/sensitivities mentioned: ${intake.allergies}`);
  if (intake.currentMedicines) summary.push(`Current medicines mentioned: ${intake.currentMedicines}`);
  if (intake.additional) summary.push(`Additional notes: ${intake.additional}`);
  if (files.length) summary.push(`${files.length} file(s) were uploaded and stored as supporting material.`);
  if (!summary.length) summary.push(`Free-text input: ${text.slice(0, 260)}`);
  return summary;
}

function buildMedicineGuidance(conditions, intake) {
  const candidates = [];
  for (const condition of conditions) {
    for (const med of condition.medicines || []) candidates.push({ key: med, condition });
  }

  const rows = [];
  const usedClasses = new Set();
  for (const { key, condition } of candidates) {
    const group = medicineClass(key);
    if (usedClasses.has(group)) continue;
    if (medicineAllowed(key, intake) && medicineFitsSymptoms(key, intake, condition) && MEDICINE_LIBRARY[key]) {
      rows.push({
        serial: rows.length + 1,
        ...MEDICINE_LIBRARY[key]
      });
      usedClasses.add(group);
    }
    if (rows.length >= 3) break;
  }
  return rows;
}

function defaultCarePlan(conditions) {
  const doNow = new Set();
  const avoid = new Set();
  const foodHydration = new Set();

  for (const condition of conditions) {
    condition.doNow.forEach((item) => doNow.add(item));
    condition.avoid.forEach((item) => avoid.add(item));
    condition.foodHydration.forEach((item) => foodHydration.add(item));
  }

  if (!doNow.size) {
    doNow.add("Track symptoms, timing, temperature, pain level, and any trigger.");
    doNow.add("Seek clinician guidance if symptoms are severe, persistent, worsening, or unusual for you.");
  }
  if (!avoid.size) avoid.add("Avoid self-starting prescription medicines or antibiotics without a clinician.");
  if (!foodHydration.size) foodHydration.add("Stay hydrated and eat light balanced food as tolerated.");

  return {
    doNow: [...doNow].slice(0, 5),
    avoid: [...avoid].slice(0, 5),
    foodHydration: [...foodHydration].slice(0, 4)
  };
}

function generateReport(intake = {}, documents = []) {
  const createdAt = new Date().toISOString();
  const id = `report-${crypto.randomBytes(8).toString("hex")}`;
  const text = combinedIntakeText(intake);
  const files = intake.files || [];
  const urgency = detectUrgency(text);
  const knowledge = searchDocuments(text, documents, {
    limit: 6,
    sourceWeights: { manual: 1, seed: 1, user: 0.55 }
  });
  const neuralPredictions = predictCondition(getNeuralConditionModel(documents), text, { limit: 4 });
  const matchedConditions = scoreConditions(text);
  const datasetConditions = datasetConditionsFromKnowledge(text, knowledge, neuralPredictions);
  const neuralConditions = conditionsFromNeuralPredictions(text, documents, neuralPredictions);
  const fallbackCondition = {
    key: "general-triage",
    name: "General symptom triage",
    explanation:
      "The input does not strongly match a specific local rule. A clinician can combine history, examination, vitals, and tests to narrow the cause.",
    evidence: ["Broad or limited symptom description"],
    terms: ["Triage: sorting symptoms by urgency and likely care pathway."],
    medicines: [],
    doNow: ["Add more details about location, duration, severity, triggers, fever, injury, and medical history."],
    avoid: ["Avoid guessing a diagnosis from one symptom alone."],
    foodHydration: ["Use normal food and fluids as tolerated unless symptoms suggest otherwise."]
  };
  const conditions = trimWeakConditionCandidates(mergeConditionCandidates(matchedConditions, datasetConditions, neuralConditions));
  const finalConditions = conditions.length ? conditions : [fallbackCondition];

  return {
    id,
    createdAt,
    patient: {
      name: intake.name || "",
      age: intake.age || "",
      sex: intake.sex || ""
    },
    source: intake.source || "manual-intake",
    summary: buildSummary(intake, text, files),
    urgency,
    possibleConditions: finalConditions.map((condition) => ({
      name: condition.name,
      confidence: conditionConfidence(condition),
      explanation: condition.explanation,
      evidence: condition.evidence && condition.evidence.length ? condition.evidence.slice(0, 5).map(formatEvidence) : ["Not enough specific evidence."]
    })),
    carePlan: defaultCarePlan(finalConditions),
    medicineGuidance: buildMedicineGuidance(finalConditions, intake),
    termExplanations: [...new Set(finalConditions.flatMap((condition) => condition.terms || []))],
    knowledgeUsed: knowledge.map((doc) => ({
      title: doc.title,
      category: doc.category,
      score: doc.score,
      url: doc.url || ""
    })),
    rawInput: {
      symptoms: intake.symptoms || "",
      visuals: intake.visuals || "",
      allergies: intake.allergies || "",
      additional: intake.additional || "",
      fileCount: files.length
    }
  };
}

module.exports = {
  generateReport,
  combinedIntakeText,
  detectUrgency
};
