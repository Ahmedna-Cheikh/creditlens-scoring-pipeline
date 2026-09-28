const API_BASE = "http://127.0.0.1:8001";
let lastContext = null;
let chatHistory = [];

// Dictée vocale : false = la phrase s'écrit dans le champ pour relecture (on envoie avec Entrée)
//                 true  = la phrase est envoyée automatiquement à la fin de la dictée
const AUTO_SEND_VOICE = false;

const FEATURE_LABELS = {
    credit_amount: "Montant du crédit",
    duration_months: "Durée du prêt",
    age: "Âge",
    monthly_installment: "Mensualité estimée",
    amount_per_age: "Montant / âge",
    duration_per_age: "Durée / âge",
    status_checking_A11: "Compte courant débiteur",
    status_checking_A12: "Compte courant 0-200 DM",
    status_checking_A13: "Compte courant ≥ 200 DM",
    status_checking_A14: "Pas de compte courant",
    savings_A61: "Épargne < 100 DM",
    savings_A62: "Épargne 100-500 DM",
    savings_A63: "Épargne 500-1000 DM",
    savings_A64: "Épargne ≥ 1000 DM",
    savings_A65: "Épargne inconnue",
    credit_history_A30: "Historique : aucun crédit",
    credit_history_A31: "Historique : crédits banque remboursés",
    credit_history_A32: "Historique : remboursements réguliers",
    credit_history_A33: "Historique : retards passés",
    credit_history_A34: "Historique : compte critique",
};
const prettyFeature = (f) => FEATURE_LABELS[f] || f.replace(/_/g, " ");

// Textes de l'interface de l'assistant selon la langue choisie
const UI_TEXT = {
    fr: {
        greeting: "Bonjour, je suis l'assistant CreditLens. Je suis à votre disposition pour vous accompagner sur ce dossier et répondre à vos questions.",
        subtitle: (d) => `Dossier ${d.decision.toLowerCase()} — score ${d.risk_score}%`,
        launcherSub: "Cliquez pour poser une question",
        placeholder: "Posez une question...",
        inputHint: "Entrée : envoyer — Maj+Entrée : nouvelle ligne",
        send: "Envoyer",
        suggestion1: "Pourquoi cette décision ?",
        suggestion2: "Comment obtenir un accord ?",
        thinking: "L'assistant réfléchit…",
        connError: (m) => `Connexion à l'API impossible : ${m}`,
        micTitle: "Poser une question à l'oral",
        micUnsupported: "La dictée vocale n'est pas prise en charge par ce navigateur. Utilisez Chrome.",
        micDenied: "Accès au micro refusé. Autorisez le micro pour ce site dans Chrome (icône à gauche de l'adresse).",
        micNoSpeech: "Je n'ai rien entendu. Cliquez sur le micro et parlez.",
        muteOn: "Activer le mode silencieux",
        muteOff: "Désactiver le mode silencieux",
        pauseReading: "Mettre en silence (pause)",
        resumeReading: "Reprendre la lecture",
        decisionWord: { "Accordé": "accordé", "Refusé": "refusé" },
    },
    en: {
        greeting: "Hello, I'm the CreditLens assistant. I'm here to support you with this file and answer your questions.",
        subtitle: (d) => `File ${(UI_TEXT.en.decisionWord[d.decision] || d.decision).toLowerCase()} — score ${d.risk_score}%`,
        launcherSub: "Click to ask a question",
        placeholder: "Ask a question...",
        inputHint: "Enter: send — Shift+Enter: new line",
        send: "Send",
        suggestion1: "Why this decision?",
        suggestion2: "How to get an approval?",
        thinking: "The assistant is thinking…",
        connError: (m) => `Unable to reach the API: ${m}`,
        micTitle: "Ask a question by voice",
        micUnsupported: "Voice input isn't supported by this browser. Please use Chrome.",
        micDenied: "Microphone access denied. Allow the microphone for this site in Chrome (icon left of the address bar).",
        micNoSpeech: "I didn't hear anything. Click the microphone and speak.",
        muteOn: "Turn on silent mode",
        muteOff: "Turn off silent mode",
        pauseReading: "Silence (pause) the reading",
        resumeReading: "Resume reading",
        decisionWord: { "Accordé": "approved", "Refusé": "declined" },
    },
};
let currentLang = "fr";
let greetingEl = null; // message d'accueil, retraduit quand on change de langue

// Éléments
const els = {
    form: document.getElementById("creditForm"),
    evalBtn: document.getElementById("evalBtn"),
    resultEmpty: document.getElementById("resultEmpty"),
    resultContent: document.getElementById("resultContent"),
    verdictBadge: document.getElementById("verdictBadge"),
    scoreNumber: document.getElementById("scoreNumber"),
    defaultProb: document.getElementById("defaultProb"),
    factorsBlock: document.getElementById("factorsBlock"),
    factorsList: document.getElementById("factorsList"),
    chatLauncher: document.getElementById("chatLauncher"),
    launcherSub: document.getElementById("launcherSub"),
    chatDrawer: document.getElementById("chatDrawer"),
    chatClose: document.getElementById("chatClose"),
    chatSubtitle: document.getElementById("chatSubtitle"),
    chatBody: document.getElementById("chatBody"),
    chatInput: document.getElementById("chatInput"),
    sendBtn: document.getElementById("sendBtn"),
    langToggle: document.getElementById("langToggle"),
    muteBtn: document.getElementById("muteBtn"),
    micBtn: document.getElementById("micBtn"),
    suggestionBtns: document.querySelectorAll("#chatSuggestions button"),
};

// ---------------------------------------------------------------------------
// Évaluation du dossier
// ---------------------------------------------------------------------------
els.form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Tant qu'une nouvelle évaluation tourne, l'assistant du dossier précédent
    // n'a plus de sens : on le referme, on coupe la lecture et on le cache.
    stopReading();
    closeChat();
    els.chatLauncher.classList.add("hidden");

    const payload = {
        status_checking: document.getElementById("status_checking").value,
        duration_months: parseInt(document.getElementById("duration_months").value),
        credit_history: document.getElementById("credit_history").value,
        purpose: "A40",
        credit_amount: parseFloat(document.getElementById("credit_amount").value),
        savings: document.getElementById("savings").value,
        employment_since: "A73",
        installment_rate: 4,
        personal_status_sex: "A93",
        other_debtors: "A101",
        residence_since: 2,
        property: "A121",
        age: parseInt(document.getElementById("age").value),
        other_installment_plans: "A143",
        housing: "A152",
        existing_credits: 1,
        job: "A173",
        people_liable: 1,
        telephone: "A192",
        foreign_worker: "A201",
    };

    els.evalBtn.disabled = true;
    els.evalBtn.textContent = "⏳ Évaluation en cours…";

    try {
        const res = await fetch(`${API_BASE}/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`Erreur serveur (${res.status})`);

        const data = await res.json();
        lastContext = data;
        chatHistory = [];

        renderResult(data);
        revealChat(data);
    } catch (err) {
        els.resultContent.classList.add("hidden");
        els.resultEmpty.classList.remove("hidden");
        els.resultEmpty.textContent = `Impossible d'évaluer le dossier : ${err.message}. Vérifiez que l'API tourne sur ${API_BASE}.`;
    } finally {
        els.evalBtn.disabled = false;
        els.evalBtn.textContent = "⚡ Évaluer le risque";
    }
});

function renderResult(data) {
    els.resultEmpty.classList.add("hidden");
    els.resultContent.classList.remove("hidden");

    const ok = data.decision === "Accordé";
    els.verdictBadge.textContent = data.decision.toUpperCase();
    els.verdictBadge.className = `badge ${ok ? "success" : "danger"}`;
    els.scoreNumber.textContent = `${data.risk_score}%`;
    els.defaultProb.textContent = data.default_probability;

    const factors = data.top_factors || [];
    if (factors.length) {
        els.factorsBlock.classList.remove("hidden");
        els.factorsList.innerHTML = factors
            .map((f) => {
                const up = f.impact > 0;
                return `<li><span>${prettyFeature(f.feature)}</span>
                        <span class="effect ${up ? "up" : "down"}">${up ? "▲ risque" : "▼ risque"}</span></li>`;
            })
            .join("");
    } else {
        els.factorsBlock.classList.add("hidden");
    }
}

// ---------------------------------------------------------------------------
// Assistant : masqué par défaut, révélé une fois la décision générée
// ---------------------------------------------------------------------------
function revealChat(data) {
    const t = UI_TEXT[currentLang];
    els.chatSubtitle.textContent = t.subtitle(data);
    els.chatBody.innerHTML = "";
    greetingEl = appendMsg(t.greeting, "bot");
    els.chatLauncher.classList.remove("hidden");
}

function openChat() {
    els.chatDrawer.classList.add("open");
    els.chatDrawer.setAttribute("aria-hidden", "false");
    els.chatInput.focus();
}
function closeChat() {
    els.chatDrawer.classList.remove("open");
    els.chatDrawer.setAttribute("aria-hidden", "true");
}

els.chatLauncher.addEventListener("click", () => {
    els.chatDrawer.classList.contains("open") ? closeChat() : openChat();
});
els.chatClose.addEventListener("click", closeChat);

// ---------------------------------------------------------------------------
// Saisie : Entrée envoie, Maj+Entrée insère un retour à la ligne
// ---------------------------------------------------------------------------
function autoGrowInput() {
    els.chatInput.style.height = "auto";
    els.chatInput.style.height = Math.min(els.chatInput.scrollHeight, 120) + "px";
}

els.chatInput.addEventListener("input", autoGrowInput);
els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
    }
});
els.sendBtn.addEventListener("click", () => sendMessage());
els.suggestionBtns.forEach((b) =>
    b.addEventListener("click", () => sendMessage(b.dataset.q))
);

async function sendMessage(forcedText) {
    const msg = (forcedText || els.chatInput.value).trim();
    if (!msg) return;

    stopReading(); // on coupe la lecture de la réponse précédente
    appendMsg(msg, "user");
    if (!forcedText) {
        els.chatInput.value = "";
        autoGrowInput();
    }
    const typing = appendMsg(UI_TEXT[currentLang].thinking, "bot typing");

    try {
        const res = await fetch(`${API_BASE}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: msg, context: lastContext, history: chatHistory, lang: currentLang }),
        });
        if (!res.ok) throw new Error(`Erreur serveur (${res.status})`);

        const data = await res.json();
        typing.remove();
        const isError = /^(Erreur|⚠️)/.test(data.reply);
        appendMsg(data.reply, isError ? "bot error" : "bot");

        if (!isError) {
            chatHistory.push({ role: "user", content: msg }, { role: "assistant", content: data.reply });
            speak(data.reply);
        }
    } catch (err) {
        typing.remove();
        appendMsg(UI_TEXT[currentLang].connError(err.message), "bot error");
    }
}

function appendMsg(text, cls) {
    const div = document.createElement("div");
    div.className = `chat-msg ${cls}`;
    div.textContent = text;
    els.chatBody.appendChild(div);
    els.chatBody.scrollTop = els.chatBody.scrollHeight;
    return div;
}

// ---------------------------------------------------------------------------
// Langue de l'assistant (FR / EN)
// ---------------------------------------------------------------------------
function setLang(lang) {
    currentLang = lang;
    const t = UI_TEXT[lang];

    els.langToggle.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", b.dataset.lang === lang);
    });

    els.chatInput.placeholder = t.placeholder;
    els.chatInput.title = t.inputHint;
    els.sendBtn.textContent = t.send;
    els.launcherSub.textContent = t.launcherSub;
    els.micBtn.title = t.micTitle;
    els.micBtn.setAttribute("aria-label", t.micTitle);

    const [s1, s2] = els.suggestionBtns;
    if (s1) { s1.textContent = t.suggestion1; s1.dataset.q = t.suggestion1; }
    if (s2) { s2.textContent = t.suggestion2; s2.dataset.q = t.suggestion2; }

    if (lastContext) els.chatSubtitle.textContent = t.subtitle(lastContext);

    // Le message d'accueil déjà affiché est traduit automatiquement.
    if (greetingEl && greetingEl.isConnected) greetingEl.textContent = t.greeting;

    stopReading(); // la voix change avec la langue : on repart proprement
    updateMuteButton();
}

els.langToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-lang]");
    if (btn) setLang(btn.dataset.lang);
});

// ---------------------------------------------------------------------------
// Lecture audio des réponses (Text-to-Speech)
//
// Le pause()/resume() natif de speechSynthesis est peu fiable dans Chrome
// (la lecture s'efface ou ne reprend pas). On découpe donc la réponse en
// phrases, on les lit une par une et on retient nous-mêmes où l'on en est :
// « silence » = on s'arrête, « reprise » = on repart de la phrase en cours.
// ---------------------------------------------------------------------------
// <tts>
const tts = { chunks: [], index: 0, state: "idle", session: 0, utter: null }; // state : idle | playing | paused
let muted = false; // mode silencieux permanent (réglé uniquement quand aucune lecture n'est en cours)
const MAX_RETRIES = 3;

function speechLangCode() {
    return currentLang === "en" ? "en-US" : "fr-FR";
}

function pickVoice(langCode) {
    const voices = window.speechSynthesis.getVoices();
    const exact = voices.find((v) => v.lang && v.lang.replace("_", "-").toLowerCase() === langCode.toLowerCase());
    if (exact) return exact;
    const prefix = langCode.slice(0, 2).toLowerCase();
    return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix)) || null;
}

// Découpe en phrases (sans casser « 26.15% »), puis regroupe les phrases très longues
function splitForSpeech(text) {
    const clean = text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/[_#>`]/g, "").trim();
    const out = [];
    const MAX = 200;

    clean.split(/\n+/).forEach((line) => {
        line.split(/(?<=[.!?…])\s+/).forEach((sentence) => {
            const s = sentence.trim();
            if (!s) return;
            if (s.length <= MAX) {
                out.push(s);
                return;
            }
            // Phrase trop longue : on la coupe aux virgules / points-virgules
            let current = "";
            s.split(/(?<=[,;:])\s+/).forEach((part) => {
                if (current && (current + " " + part).length > MAX) {
                    out.push(current);
                    current = part;
                } else {
                    current = current ? current + " " + part : part;
                }
            });
            if (current) out.push(current);
        });
    });
    return out;
}

function updateMuteButton() {
    const t = UI_TEXT[currentLang];
    let title;
    if (tts.state === "playing") title = t.pauseReading;
    else if (tts.state === "paused") title = t.resumeReading;
    else title = muted ? t.muteOff : t.muteOn;

    // 🔇 = lecture en pause (temporaire) ou mode silencieux permanent
    const silent = muted || tts.state === "paused";
    els.muteBtn.textContent = silent ? "🔇" : "🔊";
    els.muteBtn.title = title;
    els.muteBtn.setAttribute("aria-label", title);
    els.muteBtn.classList.toggle("muted", silent);
}

function speakChunk(session, attempt) {
    if (session !== tts.session || tts.state !== "playing") return;

    if (tts.index >= tts.chunks.length) {
        tts.state = "idle";
        tts.utter = null;
        updateMuteButton();
        return;
    }

    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(tts.chunks[tts.index]);
    utter.lang = speechLangCode();
    const voice = pickVoice(utter.lang);
    if (voice) utter.voice = voice;

    let watchdog = null;

    // La phrase n'a pas pu être lue (moteur audio occupé, événement perdu...) : on réessaie
    const retryOrSkip = () => {
        clearTimeout(watchdog);
        utter.onstart = utter.onend = utter.onerror = null; // ignore ses événements tardifs
        if (session !== tts.session) return;
        if (attempt < MAX_RETRIES) {
            synth.cancel();
            setTimeout(() => speakChunk(session, attempt + 1), 300 * (attempt + 1));
        } else {
            tts.index++; // après plusieurs échecs on passe à la phrase suivante
            speakChunk(session, 0);
        }
    };

    utter.onstart = () => clearTimeout(watchdog);
    utter.onend = () => {
        clearTimeout(watchdog);
        if (session !== tts.session) return; // lecture annulée ou mise en pause entre-temps
        tts.index++;
        speakChunk(session, 0);
    };
    utter.onerror = (e) => {
        clearTimeout(watchdog);
        if (e && (e.error === "interrupted" || e.error === "canceled")) return;
        console.warn("Lecture audio : erreur", e && e.error);
        retryOrSkip();
    };

    // Filet de sécurité : Chrome avale parfois la phrase sans jamais la démarrer
    watchdog = setTimeout(() => {
        if (session === tts.session && !synth.speaking && !synth.pending) {
            console.warn("Lecture audio : la phrase n'a pas démarré, nouvel essai");
            retryOrSkip();
        }
    }, 1500);

    tts.utter = utter; // garde une référence (Chrome peut sinon supprimer l'objet avant onend)
    if (synth.paused) synth.resume();
    synth.speak(utter);
}

// Attend que le moteur vocal soit libre avant de parler (évite « audio-busy » après un cancel)
function waitForEngine(session, tries) {
    if (session !== tts.session || tts.state !== "playing") return;
    const synth = window.speechSynthesis;
    if ((synth.speaking || synth.pending) && tries < 20) {
        setTimeout(() => waitForEngine(session, tries + 1), 50);
        return;
    }
    speakChunk(session, 0);
}

function playFrom(index) {
    const session = ++tts.session; // invalide les callbacks de la lecture précédente
    window.speechSynthesis.cancel();
    tts.index = index;
    tts.state = "playing";
    updateMuteButton();
    setTimeout(() => waitForEngine(session, 0), 150); // laisse Chrome vider sa file
}

function pauseReading() {
    tts.session++; // ignore les événements de la phrase interrompue
    tts.state = "paused"; // tts.index reste sur la phrase en cours
    window.speechSynthesis.cancel();
}

function stopReading() {
    tts.session++;
    tts.state = "idle";
    tts.chunks = [];
    tts.index = 0;
    tts.utter = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    updateMuteButton();
}

function speak(text) {
    if (!("speechSynthesis" in window)) return;
    stopReading();
    if (muted) return; // mode silencieux permanent : la réponse s'affiche mais n'est pas lue
    tts.chunks = splitForSpeech(text);
    if (tts.chunks.length) playFrom(0);
}

function toggleSilentMode() {
    if (!("speechSynthesis" in window)) return;
    if (tts.state === "playing") {
        // Pause temporaire de CETTE réponse (la position est gardée).
        // Ce n'est pas le mode silencieux permanent : la prochaine réponse sera lue normalement.
        pauseReading();
    } else if (tts.state === "paused") {
        // On reprend la même réponse, à la phrase où l'on s'était arrêté
        playFrom(tts.index);
    } else {
        // Rien en cours : on active / désactive le mode silencieux pour les prochaines réponses
        muted = !muted;
    }
    updateMuteButton();
}
// </tts>

els.muteBtn.addEventListener("click", toggleSilentMode);

// Certains navigateurs chargent la liste des voix de façon asynchrone
if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// ---------------------------------------------------------------------------
// Dictée vocale (Speech-to-Text) — pose une question à l'oral
// ---------------------------------------------------------------------------
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

if (!SpeechRecognitionAPI) {
    els.micBtn.disabled = true;
}

// <stt>
function startListening() {
    if (!SpeechRecognitionAPI) {
        appendMsg(UI_TEXT[currentLang].micUnsupported, "bot error");
        return;
    }
    stopReading(); // évite que le micro capte la voix de l'assistant

    const base = els.chatInput.value.trim(); // texte déjà tapé : la dictée s'ajoute derrière

    recognition = new SpeechRecognitionAPI();
    recognition.lang = speechLangCode();
    recognition.interimResults = true; // affiche le texte pendant que l'on parle
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        listening = true;
        els.micBtn.classList.add("listening");
    };
    recognition.onresult = (event) => {
        const results = Array.from(event.results);
        const text = results.map((r) => r[0].transcript).join(" ").trim();
        els.chatInput.value = base ? base + " " + text : text;
        autoGrowInput();

        if (results[results.length - 1].isFinal) {
            if (AUTO_SEND_VOICE) {
                sendMessage();
            } else {
                // La phrase reste dans le champ : on peut la relire, la corriger, puis envoyer
                els.chatInput.focus();
                const n = els.chatInput.value.length;
                els.chatInput.setSelectionRange(n, n);
            }
        }
    };
    recognition.onerror = (e) => {
        listening = false;
        els.micBtn.classList.remove("listening");
        const t = UI_TEXT[currentLang];
        if (e.error === "not-allowed" || e.error === "service-not-allowed") appendMsg(t.micDenied, "bot error");
        else if (e.error === "no-speech") appendMsg(t.micNoSpeech, "bot error");
    };
    recognition.onend = () => {
        listening = false;
        els.micBtn.classList.remove("listening");
    };

    recognition.start();
}
// </stt>

els.micBtn.addEventListener("click", () => {
    if (listening) {
        recognition?.stop();
        return;
    }
    startListening();
});

// Langue par défaut au chargement
setLang("fr");