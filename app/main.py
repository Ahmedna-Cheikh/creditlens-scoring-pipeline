import os
import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from groq import Groq

# Charge le fichier .env (à la racine du projet)
load_dotenv()

# ⚠️ Aucune clé en dur dans le code : elle doit venir du fichier .env
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
# Modèle actuel de Groq. llama3-70b-8192 est supprimé.
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

# Modèles de secours (accessibles sans contrat Enterprise) si le premier échoue
FALLBACK_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]

app = FastAPI(title="CreditLens API", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Chargement du modèle
# ---------------------------------------------------------------------------
MODEL_PATH = os.path.join("models", "xgboost_german_credit_model.joblib")
COLUMNS_PATH = os.path.join("models", "model_columns.joblib")

try:
    model = joblib.load(MODEL_PATH)
    model_columns = joblib.load(COLUMNS_PATH)
    print("✅ Modèle XGBoost et colonnes chargés avec succès !")
except Exception as e:
    model, model_columns = None, None
    print(f"❌ Erreur lors du chargement des modèles : {e}")

print(f"🤖 Assistant IA : modèle={GROQ_MODEL} | clé Groq {'présente' if GROQ_API_KEY else 'ABSENTE'}")

# ---------------------------------------------------------------------------
# Libellés lisibles (codes du jeu German Credit) pour aider le LLM
# ---------------------------------------------------------------------------
LABELS = {
    "status_checking": {
        "A11": "compte courant débiteur (< 0 DM)",
        "A12": "compte courant entre 0 et 200 DM",
        "A13": "compte courant >= 200 DM",
        "A14": "pas de compte courant",
    },
    "credit_history": {
        "A30": "aucun crédit / tous remboursés",
        "A31": "tous les crédits de cette banque remboursés",
        "A32": "crédits existants remboursés régulièrement",
        "A33": "retards de paiement dans le passé",
        "A34": "compte critique / crédits ailleurs",
    },
    "savings": {
        "A61": "épargne < 100 DM",
        "A62": "épargne 100-500 DM",
        "A63": "épargne 500-1000 DM",
        "A64": "épargne >= 1000 DM",
        "A65": "épargne inconnue / aucun compte",
    },
}


def humanize(application: dict) -> dict:
    """Ajoute des libellés lisibles aux champs codés."""
    out = dict(application)
    for field, mapping in LABELS.items():
        if field in out:
            out[field] = f"{out[field]} ({mapping.get(out[field], 'code inconnu')})"
    return out


# ---------------------------------------------------------------------------
# Schémas
# ---------------------------------------------------------------------------
class CreditApplication(BaseModel):
    status_checking: str
    duration_months: int
    credit_history: str
    purpose: str
    credit_amount: float
    savings: str
    employment_since: str
    installment_rate: int
    personal_status_sex: str
    other_debtors: str
    residence_since: int
    property: str
    age: int
    other_installment_plans: str
    housing: str
    existing_credits: int
    job: str
    people_liable: int
    telephone: str
    foreign_worker: str


class ChatMessage(BaseModel):
    message: str
    context: Optional[dict] = None
    history: Optional[list] = None  # [{"role": "user"|"assistant", "content": "..."}]
    lang: Optional[str] = "fr"  # "fr" ou "en" — langue de réponse souhaitée


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def read_root():
    return {"message": "Bienvenue sur l'API CreditLens"}


@app.get("/models")
def available_models():
    """Liste les modèles réellement accessibles avec VOTRE clé Groq."""
    try:
        client = Groq(api_key=GROQ_API_KEY)
        return {"models": sorted(m.id for m in client.models.list().data)}
    except Exception as e:
        return {"error": str(e)}


@app.get("/health")
def health():
    return {
        "model_loaded": bool(model),
        "groq_key_present": bool(GROQ_API_KEY),
        "groq_model": GROQ_MODEL,
    }


def top_risk_factors(input_encoded: pd.DataFrame, n: int = 5):
    """Contributions de chaque variable au score (valeurs de type SHAP natives XGBoost).
    Valeur > 0 : augmente le risque de défaut ; < 0 : le diminue."""
    try:
        import xgboost as xgb

        booster = model.get_booster() if hasattr(model, "get_booster") else model
        dmat = xgb.DMatrix(input_encoded.astype(float), feature_names=list(input_encoded.columns))
        contribs = booster.predict(dmat, pred_contribs=True)[0]
        pairs = list(zip(input_encoded.columns, contribs[:-1]))  # dernier = biais
        pairs.sort(key=lambda p: abs(p[1]), reverse=True)
        return [
            {
                "feature": name,
                "impact": round(float(val), 3),
                "effect": "augmente le risque" if val > 0 else "réduit le risque",
            }
            for name, val in pairs[:n]
        ]
    except Exception as e:
        print(f"⚠️ Explication des facteurs indisponible : {e}")
        return []


@app.post("/predict")
def predict_credit_risk(application: CreditApplication):
    if not model or not model_columns:
        raise HTTPException(status_code=500, detail="Modèle XGBoost non disponible.")

    input_data = pd.DataFrame([application.model_dump()])

    # Feature engineering (identique à l'entraînement)
    input_data["monthly_installment"] = input_data["credit_amount"] / input_data["duration_months"]
    input_data["amount_per_age"] = input_data["credit_amount"] / input_data["age"]
    input_data["duration_per_age"] = input_data["duration_months"] / input_data["age"]

    # One-hot encoding + alignement sur les colonnes du modèle
    input_encoded = pd.get_dummies(input_data)
    input_encoded = input_encoded.reindex(columns=model_columns, fill_value=0)

    risk_prob = float(model.predict_proba(input_encoded)[0, 1])
    decision = "Refusé" if risk_prob >= 0.5 else "Accordé"

    return {
        "decision": decision,
        "risk_score": round(risk_prob * 100, 2),
        "default_probability": round(risk_prob, 4),
        "top_factors": top_risk_factors(input_encoded),
        "application_data": application.model_dump(),
    }


LANG_INSTRUCTIONS = {
    "fr": "Réponds exclusivement en français.",
    "en": "Answer exclusively in English, even though the data below is labelled in French — "
          "translate field names and values naturally as you explain.",
}


def build_system_prompt(ctx: dict, lang: str = "fr") -> str:
    app_data = humanize(ctx.get("application_data", {})) if ctx.get("application_data") else {}
    lang_instruction = LANG_INSTRUCTIONS.get(lang, LANG_INSTRUCTIONS["fr"])
    return f"""Tu es un conseiller expert en crédit bancaire pour l'application CreditLens.
Tu t'adresses à des employés de la banque (pas au client final). Tu expliques les décisions
d'octroi de prêt de façon précise, professionnelle et pédagogique.

{lang_instruction}

Dossier actuellement évalué :
- Décision du modèle : {ctx.get('decision', 'Aucun dossier évalué')}
- Score de risque de défaut : {ctx.get('risk_score', 'N/A')} % (refus si >= 50 %)
- Facteurs qui ont le plus pesé sur le score (contributions du modèle) : {ctx.get('top_factors') or 'non disponibles'}
- Données de la demande : {app_data or 'aucune'}

Règles :
1. Si aucun dossier n'est évalué, dis-le et invite à remplir le formulaire ; tu peux quand même répondre aux questions générales sur le crédit.
2. Pour expliquer un refus ou une acceptation, appuie-toi d'abord sur les facteurs du modèle, puis sur les données (montant, durée, compte courant, épargne, historique, âge).
3. N'invente aucun chiffre absent du dossier. Le modèle est une aide à la décision : rappelle que la décision finale revient à un humain.
4. Réponds de façon concise (5 à 8 lignes maximum), sans jargon inutile, et sans markdown (pas de **gras**, pas de listes à puces) car la réponse peut être lue à voix haute.
"""


@app.post("/chat")
def credit_chatbot(msg: ChatMessage):
    if not GROQ_API_KEY:
        return {"reply": "⚠️ Clé GROQ_API_KEY absente. Ajoutez-la dans le fichier .env puis redémarrez le serveur."}

    client = Groq(api_key=GROQ_API_KEY)
    lang = (msg.lang or "fr").lower()
    if lang not in LANG_INSTRUCTIONS:
        lang = "fr"

    messages = [{"role": "system", "content": build_system_prompt(msg.context or {}, lang)}]
    for h in (msg.history or [])[-6:]:  # 6 derniers échanges pour garder le fil
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])})
    messages.append({"role": "user", "content": msg.message})

    models_to_try = [GROQ_MODEL] + [m for m in FALLBACK_MODELS if m != GROQ_MODEL]
    errors = []
    for model_name in models_to_try:
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=0.3,
                max_tokens=1500,  # marge pour les modèles à raisonnement (gpt-oss)
            )
            return {"reply": response.choices[0].message.content}
        except Exception as e:
            errors.append(f"[{model_name}] {e}")
            print(f"⚠️ Échec avec {model_name} : {e}")

    # On affiche TOUTES les erreurs (pas seulement la dernière) pour faciliter le diagnostic
    return {"reply": "Erreur de communication avec l'assistant IA :\n" + "\n".join(errors)}