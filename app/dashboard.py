import streamlit as st
import requests

st.set_page_config(
    page_title="CreditLens - Evaluation du Risque de Crédit",
    page_icon="💳",
    layout="wide"
)

st.title("💳 CreditLens - Decisioning & Risk Scoring")
st.markdown("Interface d'évaluation en temps réel du risque de crédit basée sur notre modèle XGBoost.")

# URL de l'API FastAPI
API_URL = "http://127.0.0.1:8000/predict"

st.sidebar.header("📋 Paramètres du Demandeur")

# Formulaire d'entrée
with st.sidebar.form("credit_form"):
    status_checking = st.selectbox("Statut du compte courant", ["A11", "A12", "A13", "A14"], index=0)
    duration_months = st.number_input("Durée du crédit (mois)", min_value=4, max_value=72, value=24)
    credit_history = st.selectbox("Historique de crédit", ["A30", "A31", "A32", "A33", "A34"], index=2)
    purpose = st.selectbox("Objet du prêt", ["A40", "A41", "A42", "A43", "A46", "A49", "A410"], index=0)
    credit_amount = st.number_input("Montant du crédit (€)", min_value=250, max_value=20000, value=3000)
    savings = st.selectbox("Épargne disponible", ["A61", "A62", "A63", "A64", "A65"], index=0)
    employment_since = st.selectbox("Ancienneté dans l'emploi", ["A71", "A72", "A73", "A74", "A75"], index=2)
    installment_rate = st.slider("Taux d'échéance (%)", 1, 4, 4)
    personal_status_sex = st.selectbox("Statut personnel / Sexe", ["A91", "A92", "A93", "A94"], index=2)
    other_debtors = st.selectbox("Autres garants", ["A101", "A102", "A103"], index=0)
    residence_since = st.slider("Années de résidence", 1, 4, 2)
    property = st.selectbox("Patrimoine", ["A121", "A122", "A123", "A124"], index=0)
    age = st.number_input("Âge (années)", min_value=18, max_value=80, value=35)
    other_installment_plans = st.selectbox("Autres crédits en cours", ["A141", "A142", "A143"], index=2)
    housing = st.selectbox("Logement", ["A151", "A152", "A153"], index=1)
    existing_credits = st.number_input("Nombre de crédits existants", min_value=1, max_value=4, value=1)
    job = st.selectbox("Type d'emploi", ["A171", "A172", "A173", "A174"], index=2)
    people_liable = st.number_input("Personnes à charge", min_value=1, max_value=2, value=1)
    telephone = st.selectbox("Téléphone", ["A191", "A192"], index=1)
    foreign_worker = st.selectbox("Travailleur étranger", ["A201", "A202"], index=0)

    submit_button = st.form_submit_button(label="Évaluer le Risque")

# Déclenchement de l'appel API lors du clic
if submit_button:
    payload = {
        "status_checking": status_checking,
        "duration_months": int(duration_months),
        "credit_history": credit_history,
        "purpose": purpose,
        "credit_amount": float(credit_amount),
        "savings": savings,
        "employment_since": employment_since,
        "installment_rate": int(installment_rate),
        "personal_status_sex": personal_status_sex,
        "other_debtors": other_debtors,
        "residence_since": int(residence_since),
        "property": property,
        "age": int(age),
        "other_installment_plans": other_installment_plans,
        "housing": housing,
        "existing_credits": int(existing_credits),
        "job": job,
        "people_liable": int(people_liable),
        "telephone": telephone,
        "foreign_worker": foreign_worker
    }

    try:
        response = requests.post(API_URL, json=payload)
        if response.status_code == 200:
            result = response.json()
            
            col1, col2 = st.columns(2)
            
            with col1:
                st.metric("Score de Risque (%)", f"{result['risk_score']}%")
                st.metric("Probabilité de Défaut", result['default_probability'])
            
            with col2:
                if result['risk_score'] >= 50:
                    st.error(f" Décision : {result['decision']}")
                else:
                    st.success(f" Décision : {result['decision']}")
                    
        else:
            st.error("Erreur de réponse de l'API.")
    except Exception as e:
        st.error(f"Impossible de contacter l'API. Assurez-vous que FastAPI tourne sur le port 8000. Erreur: {e}")