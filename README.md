# CreditLens - Système de Scoring de Crédit Explicable
# 💳 CreditLens - Scoring Pipeline & Financial Analytics

**CreditLens** est un pipeline complet de Machine Learning et d'évaluation du risque de crédit bancaire. Le projet intègre le traitement des données, l'entraînement d'un modèle XGBoost, une API REST d'inférence (FastAPI/Streamlit) ainsi qu'un tableau de bord analytique et interactif.

---

## 🛠️ Architecture du Projet

```text
creditlens-scoring-pipeline/
├── app/
│   ├── main.py          # API FastAPI pour l'inférence du score de crédit
│   └── dashboard.py     # Application Streamlit / Interface de visualisation
├── frontend/            # Interface Web (HTML, CSS, JavaScript)
├── models/
│   ├── xgboost_german_credit_model.joblib # Modèle d'évaluation entraîné
│   └── model_columns.joblib               # Liste des fonctionnalités / colonnes
├── data/                # Données brutes et traitées
├── notebooks/           # Notebooks d'Analyse Exploratoire (EDA) et Modélisation
├── src/                 # Scripts source et modules réutilisables
├── tests/               # Tests unitaires
├── requirements.txt     # Dépendances du projet
└── .env.example         # Exemple de variables d'environnement
