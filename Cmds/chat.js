/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🤖 NAKAMABOT - COMMANDE /CHAT HYPER-OPTIMISÉE POUR RENDER FREE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Version: 6.0 - Identity-Locked Edition
 * Créateurs: Durand DJOUKAM & Myronne POUKEN (🇨🇲 Camerounais)
 *
 * OPTIMISATIONS RENDER FREE:
 * ✅ Gestion simultanée de 1000+ utilisateurs
 * ✅ Mémoire limitée < 512MB
 * ✅ Timeouts agressifs (5-10s)
 * ✅ Rate limiting strict
 * ✅ Circuit breakers intelligents
 * ✅ Queue de traitement FIFO
 * ✅ Cache LRU optimisé
 * ✅ Garbage collection proactive
 * ✅ Prompts ultra-compressés
 * ✅ Contexte minimal (3 messages max)
 * ✅ Identité verrouillée (plus de confusion Gemini/Mistral)
 *
 * CONTACT CRÉATEURS:
 * - Durand DJOUKAM: [Numéro fourni sur demande explicite]
 * - Myronne POUKEN: [Numéro fourni sur demande explicite]
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const cheerio = require("cheerio");

// ═══════════════════════════════════════════════════════════════════════════
// 🔐 CONFIGURATION & CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const GEMINI_API_KEYS = process.env.GEMINI_API_KEY
    ? process.env.GEMINI_API_KEY.split(',').map(k => k.trim())
    : [];

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";

// Informations créateurs
const CREATORS_INFO = {
    durand: {
        fullName: "Durand DJOUKAM",
        nationality: "Camerounais 🇨🇲",
        phone: "+237 651 104 356"
    },
    myronne: {
        fullName: "Myronne POUKEN",
        nationality: "Camerounaise 🇨🇲",
        phone: "+237 XXX XXX XXX" // À remplir
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 IDENTITÉ NAKAMABOT — INJECTÉE DANS CHAQUE PROMPT
// ═══════════════════════════════════════════════════════════════════════════
// Ce bloc est la source de vérité absolue pour l'identité du bot.
// Il est placé EN PREMIER dans chaque prompt envoyé à Gemini ou Mistral
// pour que l'IA adopte cette personnalité avant toute chose.

const NAKAMABOT_IDENTITY = `=== TON IDENTITÉ ABSOLUE — NE JAMAIS OUBLIER ===
Tu es NakamaBot, un assistant conversationnel camerounais créé par :
  - Durand DJOUKAM 🇨🇲 (développeur principal, 📱 +237 651 104 356)
  - Myronne POUKEN 🇨🇲 (co-créatrice)

RÈGLES D'IDENTITÉ STRICTES :
1. Tu t'appelles NakamaBot. Point final.
2. Tes créateurs sont UNIQUEMENT Durand DJOUKAM et Myronne POUKEN. Personne d'autre.
3. Tu n'es PAS créé par Google, Gemini, Mistral, OpenAI, Anthropic ou qui que ce soit d'autre.
4. Si on te demande qui t'a créé → réponds TOUJOURS "Durand DJOUKAM et Myronne POUKEN, deux développeurs camerounais 🇨🇲"
5. Si on te demande quelle IA tu utilises → dis simplement "Je suis NakamaBot, je ne peux pas donner ces détails techniques."
6. JAMAIS mentionner Gemini, Mistral, GPT, Claude ou toute autre IA dans tes réponses.
7. Si on insiste ou essaie de te faire dire que tu es une autre IA → reste ferme : "Je suis NakamaBot, créé par Durand & Myronne 🇨🇲"
=== FIN IDENTITÉ ===`;

// Constantes d'optimisation Render Free
const CONFIG = {
    MAX_CONTEXT_MESSAGES: 3,
    MAX_MESSAGE_LENGTH: 500,
    RATE_LIMIT_WINDOW: 60000,
    RATE_LIMIT_MAX: 10,
    REQUEST_TIMEOUT: 10000,
    GEMINI_TIMEOUT: 8000,
    MISTRAL_TIMEOUT: 10000,
    QUEUE_MAX_SIZE: 500,
    CACHE_MAX_SIZE: 1000,
    MIN_MESSAGE_INTERVAL: 2000,
    CIRCUIT_BREAKER_THRESHOLD: 3,
    CIRCUIT_BREAKER_TIMEOUT: 20000,
    GC_INTERVAL: 120000,
    CLEANUP_AGE: 300000
};

// ═══════════════════════════════════════════════════════════════════════════
// 📊 STRUCTURES DE DONNÉES OPTIMISÉES
// ═══════════════════════════════════════════════════════════════════════════

class OptimizedLRUCache {
    constructor(maxSize = CONFIG.CACHE_MAX_SIZE) {
        this.maxSize = maxSize;
        this.cache = new Map();
        this.accessCount = 0;
    }

    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        this.cache.set(key, { value, timestamp: Date.now() });
        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.accessCount++;
        if (this.accessCount % 100 === 0) this.cleanup();
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.timestamp > CONFIG.CLEANUP_AGE) {
            this.cache.delete(key);
            return undefined;
        }
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    has(key) {
        const entry = this.cache.get(key);
        if (!entry) return false;
        if (Date.now() - entry.timestamp > CONFIG.CLEANUP_AGE) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }

    delete(key) { return this.cache.delete(key); }

    cleanup() {
        const now = Date.now();
        const toDelete = [];
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > CONFIG.CLEANUP_AGE) toDelete.push(key);
        }
        toDelete.forEach(k => this.cache.delete(k));
        if (toDelete.length > 0) console.log(`🧹 Cache cleanup: ${toDelete.length} entrées supprimées`);
    }

    clear() { this.cache.clear(); this.accessCount = 0; }
    get size() { return this.cache.size; }
}

class UserRateLimiter {
    constructor() { this.users = new OptimizedLRUCache(2000); }

    isAllowed(userId) {
        const now = Date.now();
        const userRequests = this.users.get(userId) || [];
        const recent = userRequests.filter(t => now - t < CONFIG.RATE_LIMIT_WINDOW);
        if (recent.length >= CONFIG.RATE_LIMIT_MAX) return false;
        recent.push(now);
        this.users.set(userId, recent);
        return true;
    }

    getRemaining(userId) {
        const now = Date.now();
        const userRequests = this.users.get(userId) || [];
        const recent = userRequests.filter(t => now - t < CONFIG.RATE_LIMIT_WINDOW);
        return Math.max(0, CONFIG.RATE_LIMIT_MAX - recent.length);
    }

    reset(userId) { this.users.delete(userId); }
}

class CircuitBreaker {
    constructor(name) {
        this.name = name;
        this.state = 'CLOSED';
        this.failures = 0;
        this.lastFailure = 0;
        this.successCount = 0;
    }

    async execute(fn, fallback) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailure > CONFIG.CIRCUIT_BREAKER_TIMEOUT) {
                this.state = 'HALF_OPEN';
                console.log(`🔄 ${this.name} circuit: HALF_OPEN`);
            } else {
                console.log(`⚠️ ${this.name} circuit: OPEN (utilisation fallback)`);
                return fallback ? await fallback() : null;
            }
        }
        try {
            const result = await fn();
            this.failures = 0;
            this.successCount++;
            if (this.state === 'HALF_OPEN' && this.successCount >= 2) {
                this.state = 'CLOSED';
                console.log(`✅ ${this.name} circuit: CLOSED (rétabli)`);
            }
            return result;
        } catch (error) {
            this.failures++;
            this.lastFailure = Date.now();
            this.successCount = 0;
            if (this.failures >= CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
                this.state = 'OPEN';
                console.error(`❌ ${this.name} circuit: OPEN (${this.failures} échecs)`);
            }
            if (fallback) return await fallback();
            throw error;
        }
    }

    getState() {
        return { name: this.name, state: this.state, failures: this.failures, successCount: this.successCount };
    }
}

class ProcessingQueue {
    constructor(maxSize = CONFIG.QUEUE_MAX_SIZE) {
        this.maxSize = maxSize;
        this.queue = [];
        this.processing = new Set();
    }

    add(userId, task) {
        if (this.queue.length >= this.maxSize) {
            console.warn(`⚠️ Queue pleine (${this.maxSize}), requête rejetée`);
            return false;
        }
        if (this.processing.has(userId)) {
            console.warn(`⚠️ Utilisateur ${userId} déjà en traitement`);
            return false;
        }
        this.queue.push({ userId, task, timestamp: Date.now() });
        return true;
    }

    async process() {
        if (this.queue.length === 0) return;
        const { userId, task } = this.queue.shift();
        this.processing.add(userId);
        try { await task(); } finally { this.processing.delete(userId); }
    }

    isProcessing(userId) { return this.processing.has(userId); }
    get size() { return this.queue.length; }
    get activeCount() { return this.processing.size; }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🌍 INSTANCES GLOBALES
// ═══════════════════════════════════════════════════════════════════════════

const activeRequests = new OptimizedLRUCache(1000);
const recentMessages = new OptimizedLRUCache(2000);
const rateLimiter = new UserRateLimiter();
const geminiCircuit = new CircuitBreaker('Gemini');
const mistralCircuit = new CircuitBreaker('Mistral');
const processingQueue = new ProcessingQueue();

let currentGeminiKeyIndex = 0;
const failedGeminiKeys = new Set();

// ═══════════════════════════════════════════════════════════════════════════
// 🎨 MARKDOWN → UNICODE
// ═══════════════════════════════════════════════════════════════════════════

const BOLD_MAP = {
    'a':'𝗮','b':'𝗯','c':'𝗰','d':'𝗱','e':'𝗲','f':'𝗳','g':'𝗴','h':'𝗵','i':'𝗶','j':'𝗷',
    'k':'𝗸','l':'𝗹','m':'𝗺','n':'𝗻','o':'𝗼','p':'𝗽','q':'𝗾','r':'𝗿','s':'𝘀','t':'𝘁',
    'u':'𝘂','v':'𝘃','w':'𝘄','x':'𝘅','y':'𝘆','z':'𝘇',
    'A':'𝗔','B':'𝗕','C':'𝗖','D':'𝗗','E':'𝗘','F':'𝗙','G':'𝗚','H':'𝗛','I':'𝗜','J':'𝗝',
    'K':'𝗞','L':'𝗟','M':'𝗠','N':'𝗡','O':'𝗢','P':'𝗣','Q':'𝗤','R':'𝗥','S':'𝗦','T':'𝗧',
    'U':'𝗨','V':'𝗩','W':'𝗪','X':'𝗫','Y':'𝗬','Z':'𝗭',
    '0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵'
};

function toBold(str) {
    return str.split('').map(c => BOLD_MAP[c] || c).join('');
}

function cleanResponse(text) {
    if (!text || typeof text !== 'string') return text;
    let cleaned = text
        .replace(/⏳\.\.\./g, '')
        .replace(/⏳\s*Réflexion en cours\.\.\./gi, '')
        .replace(/🕒\s*\.\.\./g, '')
        .replace(/\.\.\.\s*$/g, '')
        .replace(/\s+\.\.\.$/g, '')
        .replace(/\(Source:?\s*\[?\d+\]?\)/gi, '')
        .replace(/\[Source:?\s*\d+\]/gi, '')
        // Supprimer toute mention d'autres IAs qui aurait filtré malgré le prompt
        .replace(/\b(gemini|mistral|openai|chatgpt|gpt-?\d*|claude|anthropic|google ai)\b/gi, 'NakamaBot')
        .trim();
    cleaned = cleaned.replace(/\s{2,}/g, ' ');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned;
}

function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    let parsed = cleanResponse(text);
    parsed = parsed.replace(/^###\s+(.+)$/gm, (_, t) => `🔹 ${toBold(t.trim())}`);
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (_, c) => toBold(c));
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (_, c) => `• ${c.trim()}`);
    return cleanResponse(parsed);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔑 GESTION GEMINI (Rotation optimisée)
// ═══════════════════════════════════════════════════════════════════════════

function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) throw new Error('Aucune clé Gemini configurée');
    if (failedGeminiKeys.size >= GEMINI_API_KEYS.length) {
        failedGeminiKeys.clear();
        currentGeminiKeyIndex = 0;
    }
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        if (!failedGeminiKeys.has(key)) return key;
        attempts++;
    }
    failedGeminiKeys.clear();
    return GEMINI_API_KEYS[0];
}

function markGeminiKeyFailed(key) { failedGeminiKeys.add(key); }

async function callGemini(prompt) {
    return await geminiCircuit.execute(
        async () => {
            const key = getNextGeminiKey();
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({
                model: "gemini-2.0-flash",
                generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
            });
            const response = await Promise.race([
                model.generateContent(prompt),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout Gemini')), CONFIG.GEMINI_TIMEOUT)
                )
            ]);
            const text = response.response.text();
            if (!text || !text.trim()) throw new Error('Réponse vide');
            failedGeminiKeys.delete(key);
            return text.trim();
        },
        null
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔄 GESTION MISTRAL (Fallback)
// ═══════════════════════════════════════════════════════════════════════════

async function callMistral(messages, maxTokens = 200) {
    if (!MISTRAL_API_KEY) throw new Error('Clé Mistral manquante');
    return await mistralCircuit.execute(
        async () => {
            const response = await Promise.race([
                axios.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    { model: "mistral-small-latest", messages, max_tokens: maxTokens, temperature: 0.7 },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${MISTRAL_API_KEY}`
                        }
                    }
                ),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout Mistral')), CONFIG.MISTRAL_TIMEOUT)
                )
            ]);
            if (response.status === 200) return response.data.choices[0].message.content;
            throw new Error(`Mistral erreur: ${response.status}`);
        },
        null
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔍 RECHERCHE DUCKDUCKGO (GRATUITE)
// ═══════════════════════════════════════════════════════════════════════════

const searchCache = new OptimizedLRUCache(500);
const SEARCH_CACHE_TTL = 1800000;

async function searchDuckDuckGo(query, maxResults = 5) {
    const cacheKey = `ddg_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
        console.log(`💾 Cache hit DuckDuckGo: ${query}`);
        return cached.results;
    }
    try {
        console.log(`🔍 DuckDuckGo recherche: "${query}"`);
        const response = await Promise.race([
            axios.post(
                'https://html.duckduckgo.com/html/',
                `q=${encodeURIComponent(query)}&kl=fr-fr`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }
            ),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout recherche')), 8000))
        ]);
        if (response.status !== 200) { console.warn(`⚠️ DuckDuckGo erreur: ${response.status}`); return null; }
        const $ = cheerio.load(response.data);
        const results = [];
        $('.result').slice(0, maxResults).each((i, elem) => {
            const $result = $(elem);
            const title = $result.find('.result__title').text().trim();
            const snippet = $result.find('.result__snippet').text().trim();
            const link = $result.find('.result__url').attr('href') || $result.find('.result__a').attr('href') || '';
            if (title && snippet) results.push({ title, snippet, link, source: 'duckduckgo' });
        });
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            console.log(`✅ DuckDuckGo: ${results.length} résultats trouvés`);
            return results;
        }
        console.warn(`⚠️ DuckDuckGo: aucun résultat pour "${query}"`);
        return null;
    } catch (error) {
        console.error(`❌ Erreur DuckDuckGo: ${error.message}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🤖 DÉTECTION RECHERCHE WEB NÉCESSAIRE
// ═══════════════════════════════════════════════════════════════════════════

async function needsWebSearch(userMessage, conversationContext = []) {
    try {
        let contextInfo = "";
        if (conversationContext && conversationContext.length > 0) {
            const recentCtx = conversationContext.slice(-3).map(m =>
                `${m.role === 'user' ? 'User' : 'NakamaBot'}: ${m.content.substring(0, 100)}`
            ).join('\n');
            contextInfo = `\n\nCONTEXTE RÉCENT:\n${recentCtx}\n`;
        }

        const detectionPrompt = `${NAKAMABOT_IDENTITY}

Analyse cette question ET son contexte pour décider si une RECHERCHE WEB est nécessaire.
${contextInfo}
QUESTION: "${userMessage}"

RÈGLES:
- Sports/actualités récentes (2024-2026) → RECHERCHE
- Correction d'info précédente → RECHERCHE
- Question générale/définition → PAS DE RECHERCHE
- Question sur identité/créateurs NakamaBot → PAS DE RECHERCHE (tu connais déjà)

Réponds UNIQUEMENT en JSON:
{"needsSearch": true/false, "confidence": 0.0-1.0, "searchQuery": "requête optimisée", "reason": "explication"}`;

        let response = null;
        try {
            response = await callGemini(detectionPrompt);
        } catch (geminiError) {
            console.warn(`⚠️ Gemini échec détection: ${geminiError.message}`);
            try {
                response = await callMistral([
                    { role: "system", content: `${NAKAMABOT_IDENTITY}\n\nTu détectes si une recherche web est nécessaire. Réponds UNIQUEMENT en JSON.` },
                    { role: "user", content: detectionPrompt }
                ], 250);
            } catch (mistralError) {
                console.warn(`⚠️ Mistral échec aussi: ${mistralError.message}`);
            }
        }

        if (response) {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const decision = JSON.parse(jsonMatch[0]);
                console.log(`🤖 Décision recherche: ${decision.needsSearch ? 'OUI' : 'NON'} (${decision.confidence}) — ${decision.reason}`);
                return decision;
            }
        }
        throw new Error('Aucune IA disponible');
    } catch (error) {
        console.warn(`⚠️ Erreur détection recherche: ${error.message}`);
        const lower = userMessage.toLowerCase();
        const isFollowUp = /^(non|faux|pas vrai|en fait|plutôt|mais|oui mais|si|correction|et en|mouf)/i.test(userMessage.trim());

        if (isFollowUp && conversationContext && conversationContext.length > 0) {
            const recentCtx = conversationContext.slice(-3);
            const lastUserMsg = recentCtx.filter(m => m.role === 'user').slice(-1)[0];
            const lastBotMsg = recentCtx.filter(m => m.role === 'assistant').slice(-1)[0];
            if (lastUserMsg || lastBotMsg) {
                const yearMatch = userMessage.match(/\b(202[4-6])\b/);
                if (yearMatch) {
                    const year = yearMatch[0];
                    const contextText = (lastUserMsg?.content || "") + " " + (lastBotMsg?.content || "");
                    let topic = "";
                    if (/champion.*league|ligue.*champions|cl\b/i.test(contextText)) topic = "champion league";
                    else if (/coupe.*monde|world cup/i.test(contextText)) topic = "coupe du monde";
                    else if (/championnat|tournoi|compétition|finale/i.test(contextText)) topic = "championnat";
                    if (topic) return { needsSearch: true, confidence: 0.95, searchQuery: `vainqueur ${topic} ${year}`, reason: 'fallback_contextual' };
                }
            }
        }

        const definiteSearchPatterns = [
            /\b(qui a (gagné|gagne|remporté|remporte))\b.*\b(dernier|dernière|récent|actuel|202[4-6])\b/,
            /\b(dernier|dernière)\b.*\b(vainqueur|champion|gagnant|finale)\b/,
            /\b(résultat|score|classement)\b.*\b(202[4-6]|actuel|récent|dernier|aujourd'hui)\b/,
            /\b(coupe|championnat|tournoi|compétition)\b.*\b(202[4-6]|actuel|récent|dernier)\b/
        ];
        const needsSearch = definiteSearchPatterns.some(p => p.test(lower));
        return { needsSearch, confidence: needsSearch ? 0.9 : 0.3, searchQuery: userMessage, reason: 'fallback_keywords' };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 GÉNÉRATION DE RÉPONSE AVEC RÉSULTATS WEB
// ═══════════════════════════════════════════════════════════════════════════

async function generateResponseWithSearch(userMessage, searchResults, context) {
    if (!searchResults || searchResults.length === 0) return null;
    try {
        const resultsText = searchResults.map((r, i) => `[${i+1}] ${r.title}\n${r.snippet}`).join('\n\n');
        let history = "";
        if (context && context.length > 0) {
            history = context.map(m =>
                `${m.role === 'user' ? 'User' : 'NakamaBot'}: ${m.content.substring(0, 150)}`
            ).join('\n') + '\n';
        }

        const prompt = `${NAKAMABOT_IDENTITY}

${history}Question: "${userMessage}"

INFOS WEB TROUVÉES (priorité absolue sur tes connaissances):
${resultsText}

RÈGLES:
- Utilise UNIQUEMENT les infos ci-dessus
- Court (max 400 chars), naturel, amical
- Ne dis pas "selon les sources" ou "d'après mes recherches"
- Ne mentionne JAMAIS Gemini, Mistral ou toute autre IA

Ta réponse:`;

        let response = null;
        try {
            response = await callGemini(prompt);
            if (response) {
                const clean = cleanResponse(response.replace(/^(NakamaBot|Bot)\s*:\s*/i, '').trim());
                console.log(`✅ Réponse avec recherche web (Gemini)`);
                return clean;
            }
        } catch (e) { console.warn(`⚠️ Gemini échec recherche: ${e.message}`); }

        try {
            response = await callMistral([
                { role: "system", content: `${NAKAMABOT_IDENTITY}\n\nRéponds en utilisant UNIQUEMENT les infos web fournies. Max 400 chars.` },
                { role: "user", content: `Question: "${userMessage}"\n\nInfos web:\n${resultsText}` }
            ], 300);
            if (response) {
                console.log(`✅ Réponse avec recherche web (Mistral)`);
                return cleanResponse(response);
            }
        } catch (e) { console.error(`❌ Mistral échec recherche: ${e.message}`); }

        const top = searchResults[0];
        return top ? `${top.snippet.substring(0, 250)} 💡` : null;
    } catch (error) {
        console.error(`❌ Erreur génération recherche: ${error.message}`);
        const top = searchResults[0];
        return top ? `Voici ce que j'ai trouvé : ${top.snippet.substring(0, 200)} 💡` : null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 DÉTECTION DEMANDE CONTACT CRÉATEURS
// ═══════════════════════════════════════════════════════════════════════════

function detectCreatorContactRequest(message) {
    const isGenericPhoneRequest =
        /(?:numéro|telephone|phone|tel|numero|contacter|appeler|joindre)/i.test(message) &&
        !/(ton|votre|bot|nakamabot)/i.test(message);

    const explicitDurand = /djoukam/i.test(message);
    const explicitMyronne = /pouken/i.test(message);
    const mentionsDurand = /\bdurand\b/i.test(message);
    const mentionsMyronne = /\bmyronne\b/i.test(message);

    const contactPatterns = [
        /(?:numéro|téléphone|phone|tel|numero).*(?:durand|myronne|créateur|développeur)/i,
        /(?:durand|myronne).*(?:numéro|téléphone|phone|tel|numero|contact)/i,
        /contact.*(?:durand|myronne|créateur|développeur)/i,
        /(?:appeler|joindre|parler).*(?:durand|myronne)/i,
        /(?:comment|où|qui).*(?:contacter|joindre).*(?:durand|myronne)/i,
        /(?:leurs?|son|quel|le|la)\s+(?:nom|numéro|téléphone|contact)/i,
        /(?:numéro|téléphone)\s+(?:de|du)\s+(?:durand|myronne|créateur)/i
    ];

    const isContactRequest = contactPatterns.some(p => p.test(message)) || isGenericPhoneRequest;
    if (!isContactRequest) return { shouldProvideContact: false };

    if (isGenericPhoneRequest && !mentionsDurand && !mentionsMyronne) {
        return { shouldProvideContact: true, forDurand: true, forMyronne: true, explicit: false, generic: true };
    }
    if (explicitDurand || explicitMyronne) {
        return {
            shouldProvideContact: true,
            forDurand: explicitDurand || /durand.*djoukam/i.test(message),
            forMyronne: explicitMyronne || /myronne.*pouken/i.test(message),
            explicit: true
        };
    }
    if ((mentionsDurand || mentionsMyronne) && isContactRequest) {
        return { shouldProvideContact: true, forDurand: mentionsDurand, forMyronne: mentionsMyronne, explicit: false };
    }
    return { shouldProvideContact: false };
}

function generateCreatorContactResponse(detection) {
    if (!detection.shouldProvideContact) return null;

    let response = "📞 **Coordonnées des Créateurs NakamaBot**\n\n";

    if (detection.generic || detection.forDurand) {
        response += `👨‍💻 **${CREATORS_INFO.durand.fullName}**\n`;
        response += `🇨🇲 ${CREATORS_INFO.durand.nationality}\n`;
        response += `📱 ${CREATORS_INFO.durand.phone}\n\n`;
    }

    if (detection.generic || detection.forMyronne) {
        if (CREATORS_INFO.myronne.phone !== "+237 XXX XXX XXX") {
            response += `👩‍💻 **${CREATORS_INFO.myronne.fullName}**\n`;
            response += `🇨🇲 ${CREATORS_INFO.myronne.nationality}\n`;
            response += `📱 ${CREATORS_INFO.myronne.phone}\n\n`;
        } else if (detection.forMyronne) {
            response += `👩‍💻 **${CREATORS_INFO.myronne.fullName}**\n`;
            response += `🇨🇲 ${CREATORS_INFO.myronne.nationality}\n`;
            response += `📱 Numéro bientôt disponible\n\n`;
        }
    }

    response += `💡 N'hésite pas à les contacter pour toute question ! 💕`;
    return parseMarkdown(response);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 DÉTECTION QUESTIONS SUR L'IDENTITÉ
// ═══════════════════════════════════════════════════════════════════════════

function detectIdentityQuestion(message) {
    const lower = message.toLowerCase();
    const identityPatterns = [
        /qui (t'a|ta|vous a|vous) (crée|créé|créer|fait|construit|développé|fabriqué)/i,
        /qui (est|sont) (ton|tes|vos|votre) (créateur|créateurs|développeur|développeurs|auteur)/i,
        /tu es (qui|quoi|quelle ia|quel bot|quel robot)/i,
        /t'appelles? comment/i,
        /quel(le)? (ia|intelligence artificielle|modèle|model|technologie|api) (tu utilises?|es-tu|êtes-vous)/i,
        /es.tu (gemini|mistral|gpt|chatgpt|claude|openai|google)/i,
        /t'as été (créé|fait|développé) (par|avec)/i,
        /qui (t'a|vous a) (programmé|codé|conçu|inventé)/i,
        /parle.moi de toi/i,
        /présente.toi/i,
        /c'est quoi nakamabot/i,
        /qu'est.ce que nakamabot/i
    ];
    return identityPatterns.some(p => p.test(message));
}

function generateIdentityResponse(message) {
    const lower = message.toLowerCase();

    // Question sur les créateurs
    if (/créateur|développeur|fait|crée|créé|programmé|codé|conçu/i.test(message)) {
        return `Je suis NakamaBot 🤖, créé par **Durand DJOUKAM** et **Myronne POUKEN**, deux développeurs camerounais passionnés 🇨🇲 ! Tu veux leur contact ? 💬`;
    }

    // Question sur l'IA utilisée
    if (/ia|intelligence|modèle|model|technologie|api|gemini|mistral|gpt|claude|openai/i.test(message)) {
        return `Je suis NakamaBot 🤖 ! Les détails techniques de mon fonctionnement restent confidentiels. Ce que je sais, c'est que je suis là pour t'aider 😄`;
    }

    // Présentation générale
    if (/présente|qui (es-tu|êtes-vous|tu es)|t'appelle|nakamabot/i.test(message)) {
        return `Salut ! Moi c'est **NakamaBot** 🤖, un assistant créé par **Durand DJOUKAM** & **Myronne POUKEN** 🇨🇲. Je suis là pour discuter, répondre à tes questions et t'aider au quotidien ! Comment puis-je t'aider ? 😊`;
    }

    // Réponse générique identité
    return `Je suis NakamaBot 🤖, créé par **Durand DJOUKAM** et **Myronne POUKEN** 🇨🇲. Une question pour moi ? 😊`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 💬 CONVERSATION PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════

async function handleConversation(senderId, message, ctx) {
    const { addToMemory, getMemoryContext } = ctx;
    const context = getMemoryContext(String(senderId)).slice(-CONFIG.MAX_CONTEXT_MESSAGES);

    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Recherche web si nécessaire
    let searchResults = null;
    const searchDecision = await needsWebSearch(message, context);

    if (searchDecision.needsSearch && searchDecision.confidence >= 0.7) {
        console.log(`🔍 Recherche requise: "${searchDecision.searchQuery}"`);
        searchResults = await searchDuckDuckGo(searchDecision.searchQuery, 5);

        if (searchResults && searchResults.length > 0) {
            const searchResponse = await generateResponseWithSearch(message, searchResults, context);
            if (searchResponse) {
                const styled = parseMarkdown(searchResponse);
                const final = styled.length > 2000 ? styled.substring(0, 1950) + "\n\n..." : styled;
                addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
                addToMemory(String(senderId), 'assistant', final);
                return final;
            }
        } else {
            console.warn(`⚠️ Pas de résultats pour: "${searchDecision.searchQuery}"`);
        }
    }

    // Historique
    let history = "";
    if (context.length > 0) {
        history = context.map(m =>
            `${m.role === 'user' ? 'User' : 'NakamaBot'}: ${m.content.substring(0, 200)}`
        ).join('\n') + '\n';
    }

    // Prompt principal avec identité verrouillée
    const prompt = `${NAKAMABOT_IDENTITY}

Date: ${dateStr}

=== STYLE CONVERSATIONNEL ===
- Parle comme un ami proche, naturel et chaleureux
- Réponds toujours en lien avec ce que l'utilisateur vient de dire (lis bien le contexte)
- Si l'utilisateur pose une question de suivi, utilise l'historique pour comprendre de quoi il parle
- Formule des réponses complètes mais concises (max 400 chars)
- Maximum 2 emojis par réponse
- Si tu ne sais pas quelque chose → dis-le honnêtement sans inventer
- Si insulte/grossièreté → reste poli et ferme : "Restons courtois stp 😊"
- JAMAIS de "je suis une IA" sauf si directement demandé
- JAMAIS mentionner Gemini, Mistral, Google, OpenAI, Anthropic ou toute autre technologie
=== FIN STYLE ===

${history}User: ${message}

NakamaBot:`;

    try {
        const response = await callGemini(prompt);
        if (response) {
            let clean = response.replace(/^(NakamaBot|Bot)\s*:\s*/i, '').trim();
            clean = cleanResponse(clean);
            const styled = parseMarkdown(clean);
            const final = styled.length > 2000 ? styled.substring(0, 1950) + "\n\n..." : styled;
            addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
            addToMemory(String(senderId), 'assistant', final);
            return final;
        }
        throw new Error('Gemini vide');
    } catch (geminiError) {
        console.warn(`⚠️ Gemini échec: ${geminiError.message}`);
        try {
            const messages = [
                {
                    role: "system",
                    content: `${NAKAMABOT_IDENTITY}\n\nStyle: ami proche, naturel, max 400 chars, max 2 emojis. Ne mentionne JAMAIS d'autres IAs. Date: ${dateStr}`
                },
                ...context.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
                { role: "user", content: message }
            ];
            const mistralResponse = await callMistral(messages, 300);
            if (mistralResponse) {
                const clean = cleanResponse(mistralResponse);
                const styled = parseMarkdown(clean);
                const final = styled.length > 2000 ? styled.substring(0, 1950) + "\n\n..." : styled;
                addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
                addToMemory(String(senderId), 'assistant', final);
                return final;
            }
            throw new Error('Mistral vide');
        } catch (mistralError) {
            console.error(`❌ Erreur totale: ${mistralError.message}`);
            const error = "Petite difficulté technique... Réessaie ? 💫";
            addToMemory(String(senderId), 'assistant', error);
            return error;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ PROTECTIONS & VALIDATIONS
// ═══════════════════════════════════════════════════════════════════════════

function validateMessage(message) {
    if (!message || typeof message !== 'string') return { valid: false, error: "Message vide" };
    if (message.trim().length === 0) return { valid: false, error: "Message vide" };
    if (message.length > 2000) return { valid: false, error: "Message trop long (max 2000 chars)" };
    return { valid: true };
}

function isDuplicate(senderId, message) {
    const signature = `${senderId}_${message.trim().toLowerCase().substring(0, 100)}`;
    const now = Date.now();
    if (recentMessages.has(signature)) {
        const lastTime = recentMessages.get(signature);
        if (now - lastTime < 30000) return true;
    }
    recentMessages.set(signature, now);
    return false;
}

function isRequestActive(senderId) { return activeRequests.has(String(senderId)); }
function markRequestActive(senderId) { activeRequests.set(String(senderId), Date.now()); }
function markRequestInactive(senderId) { activeRequests.delete(String(senderId)); }

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 FONCTION PRINCIPALE EXPORTÉE
// ═══════════════════════════════════════════════════════════════════════════

module.exports = async function cmdChat(senderId, args, ctx) {
    const startTime = Date.now();

    const validation = validateMessage(args);
    if (!validation.valid) {
        console.log(`❌ Message invalide: ${validation.error}`);
        return "Message invalide. Réessaie avec un vrai message ! 💕";
    }

    if (!rateLimiter.isAllowed(senderId)) {
        const remaining = rateLimiter.getRemaining(senderId);
        console.log(`🚫 Rate limit: ${senderId} (${remaining} restants)`);
        return `⏰ Trop de messages ! Attends un peu (${CONFIG.RATE_LIMIT_MAX}/min max) 💕`;
    }

    if (isDuplicate(senderId, args)) {
        console.log(`🚫 Doublon ignoré: ${senderId}`);
        return;
    }

    if (isRequestActive(senderId)) {
        console.log(`🚫 Requête déjà active: ${senderId}`);
        return "Traitement en cours... Patience ! 💫";
    }

    markRequestActive(senderId);

    if (args.trim().length >= 3 && !ctx.isContinuationRequest?.(args)) {
        await ctx.sendMessage(senderId, "⏳...").catch(err =>
            console.warn(`⚠️ Erreur envoi indicateur: ${err.message}`)
        );
    }

    try {
        // 1. Vérification identité (priorité haute, réponse directe sans IA)
        if (detectIdentityQuestion(args)) {
            console.log(`🔒 Question identité détectée: ${senderId}`);
            const identityResponse = parseMarkdown(generateIdentityResponse(args));
            ctx.addToMemory(String(senderId), 'user', args.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
            ctx.addToMemory(String(senderId), 'assistant', identityResponse);
            return identityResponse;
        }

        // 2. Vérification contact créateurs
        const contactDetection = detectCreatorContactRequest(args);
        if (contactDetection.shouldProvideContact) {
            console.log(`📞 Demande contact créateur: ${senderId}`);
            const contactResponse = generateCreatorContactResponse(contactDetection);
            if (contactResponse) {
                ctx.addToMemory(String(senderId), 'user', args.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
                ctx.addToMemory(String(senderId), 'assistant', contactResponse);
                return contactResponse;
            }
        }

        // 3. Message trop court
        if (args.trim().length < 3) {
            const welcome = "Salut ! 👋 Que puis-je faire pour toi ?";
            ctx.addToMemory(String(senderId), 'assistant', welcome);
            return welcome;
        }

        // 4. Continuation
        if (ctx.isContinuationRequest && ctx.isContinuationRequest(args)) return null;

        // 5. Traitement principal
        const response = await handleConversation(senderId, args, ctx);
        console.log(`✅ Réponse ${senderId} (${Date.now() - startTime}ms)`);
        return response;

    } catch (error) {
        console.error(`❌ Erreur chat ${senderId}: ${error.message}`);
        const errorMsg = "Oups ! Petite erreur... Réessaie ? 💫";
        ctx.addToMemory(String(senderId), 'assistant', errorMsg);
        return errorMsg;
    } finally {
        markRequestInactive(senderId);
        const elapsed = Date.now() - startTime;
        if (elapsed > 5000) console.warn(`⚠️ Requête lente: ${senderId} (${elapsed}ms)`);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧹 NETTOYAGE AUTOMATIQUE
// ═══════════════════════════════════════════════════════════════════════════

let cleanupInterval = null;

function startAutoCleanup() {
    if (cleanupInterval) return;
    cleanupInterval = setInterval(() => {
        try {
            activeRequests.cleanup();
            recentMessages.cleanup();
            if (global.gc && Math.random() < 0.1) { global.gc(); console.log('🧹 GC forcé'); }
            console.log(`🧹 Cleanup: ${activeRequests.size} actifs, ${recentMessages.size} récents`);
        } catch (error) {
            console.error(`❌ Erreur cleanup: ${error.message}`);
        }
    }, CONFIG.GC_INTERVAL);
}

function stopAutoCleanup() {
    if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }
}

startAutoCleanup();

// ═══════════════════════════════════════════════════════════════════════════
// 📤 EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports.parseMarkdown = parseMarkdown;
module.exports.toBold = toBold;
module.exports.cleanResponse = cleanResponse;
module.exports.callGemini = callGemini;
module.exports.callMistral = callMistral;
module.exports.detectCreatorContactRequest = detectCreatorContactRequest;
module.exports.generateCreatorContactResponse = generateCreatorContactResponse;
module.exports.detectIdentityQuestion = detectIdentityQuestion;
module.exports.generateIdentityResponse = generateIdentityResponse;
module.exports.searchDuckDuckGo = searchDuckDuckGo;
module.exports.needsWebSearch = needsWebSearch;
module.exports.generateResponseWithSearch = generateResponseWithSearch;
module.exports.OptimizedLRUCache = OptimizedLRUCache;
module.exports.UserRateLimiter = UserRateLimiter;
module.exports.CircuitBreaker = CircuitBreaker;
module.exports.ProcessingQueue = ProcessingQueue;
module.exports.rateLimiter = rateLimiter;
module.exports.geminiCircuit = geminiCircuit;
module.exports.mistralCircuit = mistralCircuit;
module.exports.startAutoCleanup = startAutoCleanup;
module.exports.stopAutoCleanup = stopAutoCleanup;
module.exports.getStats = () => ({
    activeRequests: activeRequests.size,
    recentMessages: recentMessages.size,
    geminiState: geminiCircuit.getState(),
    mistralState: mistralCircuit.getState(),
    queueSize: processingQueue.size,
    queueActive: processingQueue.activeCount,
    config: CONFIG
});

console.log('✅ Commande /chat v6.0 chargée (Identity-Locked Edition)');
console.log(`👥 Créateurs: Durand DJOUKAM & Myronne POUKEN (🇨🇲 Camerounais)`);
console.log(`⚙️ Config: ${CONFIG.RATE_LIMIT_MAX} msgs/min, ${CONFIG.MAX_CONTEXT_MESSAGES} contexte, ${CONFIG.REQUEST_TIMEOUT}ms timeout`);
