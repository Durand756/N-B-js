/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🤖 NAKAMABOT - COMMANDE /CHAT HYPER-OPTIMISÉE POUR RENDER FREE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Version: 5.1 - Multi-User Concurrent Edition
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

const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? 
    process.env.GEMINI_API_KEY.split(',').map(k => k.trim()) : [];

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";

// Informations créateurs (affichées uniquement sur demande explicite)
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

// Constantes d'optimisation Render Free
const CONFIG = {
    MAX_CONTEXT_MESSAGES: 3,        // Contexte minimal
    MAX_MESSAGE_LENGTH: 500,        // Limite par message
    RATE_LIMIT_WINDOW: 60000,       // 1 minute
    RATE_LIMIT_MAX: 10,             // 10 messages/min
    REQUEST_TIMEOUT: 10000,         // 10 secondes
    GEMINI_TIMEOUT: 8000,           // 8 secondes Gemini
    MISTRAL_TIMEOUT: 10000,         // 10 secondes Mistral
    QUEUE_MAX_SIZE: 500,            // File d'attente max
    CACHE_MAX_SIZE: 1000,           // Cache LRU max
    MIN_MESSAGE_INTERVAL: 2000,     // 2s entre messages
    CIRCUIT_BREAKER_THRESHOLD: 3,   // 3 échecs = ouverture
    CIRCUIT_BREAKER_TIMEOUT: 20000, // 20s avant réessai
    GC_INTERVAL: 120000,            // GC toutes les 2 minutes
    CLEANUP_AGE: 300000             // Nettoyage > 5 minutes
};

// ═══════════════════════════════════════════════════════════════════════════
// 📊 STRUCTURES DE DONNÉES OPTIMISÉES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cache LRU ultra-optimisé pour Render Free
 */
class OptimizedLRUCache {
    constructor(maxSize = CONFIG.CACHE_MAX_SIZE) {
        this.maxSize = maxSize;
        this.cache = new Map();
        this.accessCount = 0;
    }
    
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
        
        // Éviction immédiate si dépassement
        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        // Cleanup périodique
        this.accessCount++;
        if (this.accessCount % 100 === 0) {
            this.cleanup();
        }
    }
    
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        
        // Vérifier expiration
        if (Date.now() - entry.timestamp > CONFIG.CLEANUP_AGE) {
            this.cache.delete(key);
            return undefined;
        }
        
        // Refresh position
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
    
    delete(key) {
        return this.cache.delete(key);
    }
    
    cleanup() {
        const now = Date.now();
        const toDelete = [];
        
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > CONFIG.CLEANUP_AGE) {
                toDelete.push(key);
            }
        }
        
        toDelete.forEach(key => this.cache.delete(key));
        
        if (toDelete.length > 0) {
            console.log(`🧹 Cache cleanup: ${toDelete.length} entrées supprimées`);
        }
    }
    
    clear() {
        this.cache.clear();
        this.accessCount = 0;
    }
    
    get size() {
        return this.cache.size;
    }
}

/**
 * Rate Limiter par utilisateur
 */
class UserRateLimiter {
    constructor() {
        this.users = new OptimizedLRUCache(2000);
    }
    
    isAllowed(userId) {
        const now = Date.now();
        const userRequests = this.users.get(userId) || [];
        
        // Nettoyer anciennes requêtes
        const recent = userRequests.filter(
            t => now - t < CONFIG.RATE_LIMIT_WINDOW
        );
        
        if (recent.length >= CONFIG.RATE_LIMIT_MAX) {
            return false;
        }
        
        recent.push(now);
        this.users.set(userId, recent);
        return true;
    }
    
    getRemaining(userId) {
        const now = Date.now();
        const userRequests = this.users.get(userId) || [];
        const recent = userRequests.filter(
            t => now - t < CONFIG.RATE_LIMIT_WINDOW
        );
        return Math.max(0, CONFIG.RATE_LIMIT_MAX - recent.length);
    }
    
    reset(userId) {
        this.users.delete(userId);
    }
}

/**
 * Circuit Breaker pour APIs
 */
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
            
            // Succès
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
            
            if (fallback) {
                return await fallback();
            }
            throw error;
        }
    }
    
    getState() {
        return {
            name: this.name,
            state: this.state,
            failures: this.failures,
            successCount: this.successCount
        };
    }
}

/**
 * Queue de traitement FIFO pour gérer la charge
 */
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
        
        try {
            await task();
        } finally {
            this.processing.delete(userId);
        }
    }
    
    isProcessing(userId) {
        return this.processing.has(userId);
    }
    
    get size() {
        return this.queue.length;
    }
    
    get activeCount() {
        return this.processing.size;
    }
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
// 🎨 MARKDOWN → UNICODE (Version compacte)
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

/**
 * Nettoie la réponse des indicateurs de traitement et formatages indésirables
 */
function cleanResponse(text) {
    if (!text || typeof text !== 'string') return text;
    
    // Supprimer tous les indicateurs de traitement
    let cleaned = text
        .replace(/⏳\.\.\./g, '')
        .replace(/⏳\s*Réflexion en cours\.\.\./gi, '')
        .replace(/🕒\s*\.\.\./g, '')
        .replace(/\.\.\.\s*$/g, '')
        .replace(/\s+\.\.\.$/g, '')
        .replace(/\(Source:?\s*\[?\d+\]?\)/gi, '')
        .replace(/\[Source:?\s*\d+\]/gi, '')
        .trim();
    
    // Supprimer multiples espaces
    cleaned = cleaned.replace(/\s{2,}/g, ' ');
    
    // Supprimer multiples retours à la ligne
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    return cleaned;
}

function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    
    // Nettoyer d'abord
    let parsed = cleanResponse(text);
    
    // Titres
    parsed = parsed.replace(/^###\s+(.+)$/gm, (_, t) => `🔹 ${toBold(t.trim())}`);
    
    // Gras
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (_, c) => toBold(c));
    
    // Listes
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (_, c) => `• ${c.trim()}`);
    
    // Nettoyer une dernière fois
    return cleanResponse(parsed);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔑 GESTION GEMINI (Rotation optimisée)
// ═══════════════════════════════════════════════════════════════════════════

function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    // Reset si toutes échouées
    if (failedGeminiKeys.size >= GEMINI_API_KEYS.length) {
        failedGeminiKeys.clear();
        currentGeminiKeyIndex = 0;
    }
    
    // Trouver clé valide
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        
        if (!failedGeminiKeys.has(key)) {
            return key;
        }
        attempts++;
    }
    
    // Dernier recours
    failedGeminiKeys.clear();
    return GEMINI_API_KEYS[0];
}

function markGeminiKeyFailed(key) {
    failedGeminiKeys.add(key);
}

async function callGemini(prompt) {
    return await geminiCircuit.execute(
        async () => {
            const key = getNextGeminiKey();
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-3-flash-preview",
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 500
                }
            });
            
            // Timeout strict
            const response = await Promise.race([
                model.generateContent(prompt),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout Gemini')), CONFIG.GEMINI_TIMEOUT)
                )
            ]);
            
            const text = response.response.text();
            if (!text || !text.trim()) {
                throw new Error('Réponse vide');
            }
            
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
    if (!MISTRAL_API_KEY) {
        throw new Error('Clé Mistral manquante');
    }
    
    return await mistralCircuit.execute(
        async () => {
            const response = await Promise.race([
                axios.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    {
                        model: "mistral-small-latest",
                        messages: messages,
                        max_tokens: maxTokens,
                        temperature: 0.7
                    },
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
            
            if (response.status === 200) {
                return response.data.choices[0].message.content;
            }
            
            throw new Error(`Mistral erreur: ${response.status}`);
        },
        null
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔍 RECHERCHE DUCKDUCKGO (GRATUITE)
// ═══════════════════════════════════════════════════════════════════════════

const searchCache = new OptimizedLRUCache(500);
const SEARCH_CACHE_TTL = 1800000; // 30 minutes

/**
 * Recherche DuckDuckGo HTML (gratuit, sans API)
 */
async function searchDuckDuckGo(query, maxResults = 5) {
    const cacheKey = `ddg_${query.toLowerCase()}`;
    
    // Vérifier cache
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
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout recherche')), 8000)
            )
        ]);
        
        if (response.status !== 200) {
            console.warn(`⚠️ DuckDuckGo erreur: ${response.status}`);
            return null;
        }
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('.result').slice(0, maxResults).each((i, elem) => {
            const $result = $(elem);
            const title = $result.find('.result__title').text().trim();
            const snippet = $result.find('.result__snippet').text().trim();
            const link = $result.find('.result__url').attr('href') || 
                        $result.find('.result__a').attr('href') || '';
            
            if (title && snippet) {
                results.push({
                    title,
                    snippet,
                    link,
                    source: 'duckduckgo'
                });
            }
        });
        
        if (results.length > 0) {
            searchCache.set(cacheKey, {
                results,
                timestamp: Date.now()
            });
            
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

/**
 * Détection IA intelligente des requêtes nécessitant une recherche web
 */
async function needsWebSearch(userMessage, conversationContext = []) {
    try {
        // Analyser le contexte pour mieux comprendre les questions de suivi
        let contextInfo = "";
        if (conversationContext && conversationContext.length > 0) {
            const recentMsgs = conversationContext.slice(-3).map(m => 
                `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content.substring(0, 100)}`
            ).join('\n');
            
            contextInfo = `\n\nCONTEXTE CONVERSATION RÉCENTE:\n${recentMsgs}\n`;
        }
        
        const currentYear = new Date().getFullYear(); // 2025 ou 2026
        const detectionPrompt = `Analyse cette question ET son contexte pour décider si elle nécessite une RECHERCHE WEB récente.
${contextInfo}
QUESTION ACTUELLE: "${userMessage}"

RÈGLES:
- Si la question fait référence au contexte (ex: "non en 2025" après avoir parlé de Champion League) → chercher Champion League 2025
- Si "qui a gagné X" + année récente (2024-2026) → RECHERCHE
- Si correction d'info précédente (ex: "non", "faux", "pas vrai") → RECHERCHE pour vérifier
- Sports, actualités, compétitions récentes → RECHERCHE
- Question générale ou définition → PAS DE RECHERCHE

IMPORTANT: Si la recherche est nécessaire, la requête doit OBLIGATOIREMENT inclure l'année ${currentYear} ou 2025 pour avoir des résultats récents.

Si la question corrige une info ou ajoute une année, UTILISE LE CONTEXTE pour comprendre de quoi on parle vraiment.

Réponds UNIQUEMENT en JSON:
{
  "needsSearch": true/false,
  "confidence": 0.0-1.0,
  "searchQuery": "requête optimisée AVEC ANNÉE ${currentYear} ou 2025 EN TENANT COMPTE DU CONTEXTE",
  "reason": "explication"
}`;

        let response = null;
        
        // Tentative Gemini d'abord
        try {
            response = await callGemini(detectionPrompt);
        } catch (geminiError) {
            console.warn(`⚠️ Gemini échec détection, tentative Mistral: ${geminiError.message}`);
            
            // Fallback Mistral
            try {
                const messages = [
                    {
                        role: "system",
                        content: "Tu es un système de détection intelligent. Analyse le contexte conversationnel. Réponds UNIQUEMENT en JSON."
                    },
                    {
                        role: "user",
                        content: detectionPrompt
                    }
                ];
                
                response = await callMistral(messages, 250);
            } catch (mistralError) {
                console.warn(`⚠️ Mistral échec aussi: ${mistralError.message}`);
            }
        }
        
        if (response) {
            // Parser réponse JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const decision = JSON.parse(jsonMatch[0]);
                
                // Forcer l'année récente dans la searchQuery si absent
                if (decision.needsSearch && decision.searchQuery) {
                    const hasYear = /\b(2024|2025|2026)\b/.test(decision.searchQuery);
                    if (!hasYear) {
                        const yr = new Date().getFullYear();
                        decision.searchQuery = `${decision.searchQuery} ${yr}`;
                        console.log(`📅 Année forcée dans query: "${decision.searchQuery}"`);
                    }
                }
                
                console.log(`🤖 Décision recherche: ${decision.needsSearch ? 'OUI' : 'NON'} (${decision.confidence})`);
                console.log(`📝 Raison: ${decision.reason}`);
                console.log(`🔍 Query: ${decision.searchQuery}`);
                
                return decision;
            }
        }
        
        throw new Error('Aucune IA disponible');
        
    } catch (error) {
        console.warn(`⚠️ Erreur détection recherche: ${error.message}`);
        
        // Fallback intelligent par analyse du contexte
        const lower = userMessage.toLowerCase();
        
        // Vérifier si c'est une correction/suite de conversation
        const isFollowUp = /^(non|faux|pas vrai|en fait|plutôt|mais|oui mais|si|correction|et en|mouf)/i.test(userMessage.trim());
        
        if (isFollowUp && conversationContext && conversationContext.length > 0) {
            // Extraire le sujet du contexte précédent
            const recentMsgs = conversationContext.slice(-3);
            const lastUserMsg = recentMsgs.filter(m => m.role === 'user').slice(-1)[0];
            const lastBotMsg = recentMsgs.filter(m => m.role === 'assistant').slice(-1)[0];
            
            if (lastUserMsg || lastBotMsg) {
                // Si c'est une correction avec année, chercher le sujet original + nouvelle année
                const yearMatch = userMessage.match(/\b(202[4-6]|2025|2024|2026)\b/);
                
                if (yearMatch) {
                    const year = yearMatch[0];
                    
                    // Extraire sujet principal du contexte
                    let topic = "";
                    const contextText = (lastUserMsg?.content || "") + " " + (lastBotMsg?.content || "");
                    
                    if (/champion.*league|ligue.*champions|cl\b/i.test(contextText)) {
                        topic = "champion league";
                    } else if (/coupe.*monde|world cup/i.test(contextText)) {
                        topic = "coupe du monde";
                    } else if (/championnat|tournoi|compétition|finale/i.test(contextText)) {
                        const sportMatch = contextText.match(/(football|basket|tennis|rugby|\w+)/i);
                        topic = sportMatch ? sportMatch[0] : "championnat";
                    }
                    
                    if (topic) {
                        console.log(`🔑 Fallback contextuel: sujet="${topic}", année=${year}`);
                        return {
                            needsSearch: true,
                            confidence: 0.95,
                            searchQuery: `vainqueur ${topic} ${year}`,
                            reason: 'fallback_contextual_follow_up'
                        };
                    }
                }
                
                // Si juste "mouf", "non", etc. sans année mais contexte sportif clair
                if (/champion.*league|ligue.*champions|coupe|championnat|finale/i.test((lastUserMsg?.content || "") + " " + (lastBotMsg?.content || ""))) {
                    const currentYear = new Date().getFullYear();
                    let topic = "";
                    const contextText = (lastUserMsg?.content || "") + " " + (lastBotMsg?.content || "");
                    
                    if (/champion.*league|ligue.*champions/i.test(contextText)) {
                        topic = "champion league";
                    } else if (/coupe.*monde/i.test(contextText)) {
                        topic = "coupe du monde";
                    }
                    
                    if (topic) {
                        console.log(`🔑 Fallback contextuel année courante: sujet="${topic}"`);
                        return {
                            needsSearch: true,
                            confidence: 0.9,
                            searchQuery: `vainqueur ${topic} ${currentYear}`,
                            reason: 'fallback_contextual_current_year'
                        };
                    }
                }
            }
        }
        
        // Patterns standards avec années 2025-2026 forcées
        const currentYr = new Date().getFullYear();
        const definiteSearchPatterns = [
            /\b(qui a (gagné|gagne|remporté|remporte))\b.*\b(dernier|dernière|récent|actuel|202[4-6])\b/,
            /\b(dernier|dernière)\b.*\b(vainqueur|champion|gagnant|finale)\b/,
            /\b(résultat|score|classement)\b.*\b(202[4-6]|actuel|récent|dernier|aujourd'hui)\b/,
            /\b(coupe|championnat|tournoi|compétition)\b.*\b(202[4-6]|actuel|récent|dernier)\b/
        ];
        
        const needsSearch = definiteSearchPatterns.some(pattern => pattern.test(lower));
        
        // Forcer l'année dans la query si pas déjà présente
        let searchQuery = userMessage;
        if (needsSearch && !/\b(2024|2025|2026)\b/.test(searchQuery)) {
            searchQuery = `${searchQuery} ${currentYr}`;
        }
        
        console.log(`🔑 Fallback keywords: ${needsSearch ? 'RECHERCHE' : 'NORMAL'}`);
        
        return {
            needsSearch,
            confidence: needsSearch ? 0.9 : 0.3,
            searchQuery,
            reason: 'fallback_keywords_advanced'
        };
    }
}

/**
 * Génère une réponse naturelle avec les résultats de recherche
 */
async function generateResponseWithSearch(userMessage, searchResults, context) {
    if (!searchResults || searchResults.length === 0) {
        return null;
    }
    
    try {
        // Formater les résultats
        const resultsText = searchResults.map((r, i) => 
            `[${i+1}] ${r.title}\n${r.snippet}`
        ).join('\n\n');
        
        // Contexte conversation
        let history = "";
        if (context && context.length > 0) {
            history = context.map(m => 
                `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content.substring(0, 150)}`
            ).join('\n') + '\n';
        }
        
        const currentYear = new Date().getFullYear();
        const prompt = `${history}Question: "${userMessage}"

INFORMATIONS TROUVÉES SUR LE WEB (${currentYear}) :
${resultsText}

RÈGLES CRITIQUES:
- Utilise UNIQUEMENT les infos ci-dessus
- Ces infos sont PLUS RÉCENTES que tes connaissances (elles datent de ${currentYear})
- Si contradictions → UTILISE LES INFOS WEB
- N'invente RIEN
- Réponds court (max 400 chars)
- Ne dis JAMAIS "selon les sources" ou "d'après mes recherches"
- Réponds naturellement comme si tu connaissais ces infos

Ta réponse basée sur les infos trouvées:`;

        // Tentative Gemini d'abord
        let response = null;
        
        try {
            response = await callGemini(prompt);
            
            if (response) {
                // Nettoyer préfixes
                let clean = response.replace(/^(NakamaBot|Bot)\s*:\s*/i, '').trim();
                console.log(`✅ Réponse générée avec recherche web (Gemini)`);
                return clean;
            }
        } catch (geminiError) {
            console.warn(`⚠️ Gemini échec, tentative Mistral: ${geminiError.message}`);
        }
        
        // Fallback Mistral si Gemini échoue
        try {
            const messages = [
                {
                    role: "system",
                    content: `Tu es NakamaBot. Réponds UNIQUEMENT avec les infos web fournies. Court et naturel. Max 400 chars.`
                },
                {
                    role: "user",
                    content: `Question: "${userMessage}"\n\nInfos web trouvées:\n${resultsText}\n\nRéponds naturellement en utilisant CES infos (pas tes connaissances):`
                }
            ];
            
            response = await callMistral(messages, 300);
            
            if (response) {
                console.log(`✅ Réponse générée avec recherche web (Mistral)`);
                return response;
            }
        } catch (mistralError) {
            console.error(`❌ Mistral échec aussi: ${mistralError.message}`);
        }
        
        // Dernier recours : résumé simple du premier résultat
        const topResult = searchResults[0];
        if (topResult) {
            return `D'après les dernières infos, ${topResult.snippet} 💡`;
        }
        
        throw new Error('Toutes les IAs ont échoué');
        
    } catch (error) {
        console.error(`❌ Erreur génération avec recherche: ${error.message}`);
        
        // Fallback final très simple
        const topResult = searchResults[0];
        if (topResult) {
            return `Voici ce que j'ai trouvé : ${topResult.snippet.substring(0, 200)} 💡`;
        }
        
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 DÉTECTION QUESTIONS SUR LES CRÉATEURS & DÉTAILS TECHNIQUES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Détecte si le message pose des questions sur les détails techniques de création
 */
function detectTechnicalCreationQuestion(message) {
    const technicalPatterns = [
        /comment (tu as été|t'a été|as été|avez été|tu es|es) (créé|créée|fait|faite|développé|développée|conçu|conçue|programmé|programmée|construit|construite)/i,
        /quel(le)? (technologie|langage|framework|outil|modèle|api|intelligence artificielle|ia|moteur)/i,
        /tu (utilises?|fonctionnes?|marches?) (avec|sur|grâce)/i,
        /(gemini|mistral|openai|gpt|chatgpt|claude|llm|large language|transformers?)\s*(est|sont)?\s*(ton|ta|tes|le|la|les)?\s*(modèle|base|moteur|cerveau)/i,
        /basé(e)? sur (gemini|mistral|openai|gpt|chatgpt|llm)/i,
        /ton (modèle|moteur|cerveau|ia|intelligence)/i,
        /quelle? (ia|intelligence artificielle|api) (tu utilises?|derrière toi|te fait)/i,
        /(comment|avec quoi) (tu (fonctionnes?|marches?|travailles?|réponds?))/i,
        /architecture (du bot|de ton|de toi)/i,
        /c'est quoi (ton moteur|ta base|ton ia|ton intelligence)/i
    ];
    
    return technicalPatterns.some(p => p.test(message));
}

/**
 * Génère une réponse refusant de divulguer les détails techniques
 */
function generateTechnicalRefusalResponse() {
    const responses = [
        `Hehe, c'est un petit secret de fabrication ! 😄 Ce que je sais, c'est que **Durand** (📱 ${CREATORS_INFO.durand.phone}) et **Myronne** m'ont créée avec beaucoup d'amour 💕 Pour les détails techniques, contacte-les directement !`,
        `Mystère et boule de gomme ! 🎭 Mes créateurs **Durand** et **Myronne** gardent ça pour eux. Pose-leur la question en direct : Durand au 📱 ${CREATORS_INFO.durand.phone} 😊`,
        `Ça, c'est la recette secrète de mes créateurs 🤫💝 **Durand DJOUKAM** et **Myronne POUKEN** ont mis tout leur amour pour me faire naître, mais les détails techniques... c'est leur jardin privé ! Contacte Durand au 📱 ${CREATORS_INFO.durand.phone}`,
        `Je suis NakamaBot, créée avec amour par **Durand** et **Myronne** 💕 Pour ce qui est de comment je fonctionne en coulisses... je laisse mes créateurs répondre à ça ! 📱 Durand : ${CREATORS_INFO.durand.phone}`,
    ];
    
    const chosen = responses[Math.floor(Math.random() * responses.length)];
    return parseMarkdown(chosen);
}

/**
 * Détecte si le message demande qui a créé le bot / qui sont les créateurs
 */
function detectCreatorIdentityQuestion(message) {
    const identityPatterns = [
        /qui (t'a|vous a|te|vous) (créé|créée|fait|faite|développé|développée|conçu|conçue|programmé|programmée)/i,
        /qui (est|sont) (ton|ta|tes|vos|votre) (créateur|créatrice|créateurs|développeur|développeuse|auteur|autrice)/i,
        /qui (t'a|vous a) (donné vie|mis au monde|inventé|inventée)/i,
        /c'est qui (ton|ta|tes) (créateur|créatrice|papa|maman|géniteur|génitrice)/i,
        /tu as été (créé|créée) par qui/i,
        /d'où (tu viens|viens-tu|tu es)/i,
        /qui (est|sont) (derrière toi|tes parents|tes créateurs)/i,
        /tes? (vrais?|véritables?) (créateurs?|parents?|auteurs?)/i,
        /qui (t'a|ta) (fait|créé|programmé|développé)/i
    ];
    
    return identityPatterns.some(p => p.test(message));
}

/**
 * Génère une réponse sur l'identité des créateurs (sans détails techniques)
 */
function generateCreatorIdentityResponse() {
    const response = 
`💝 Je suis NakamaBot, une fille bot créée avec énormément d'amour par mes deux créateurs :

👨‍💻 **Durand DJOUKAM** 🇨🇲
👩‍💻 **Myronne POUKEN** 🇨🇲

Et le plus beau dans tout ça ? Ils sont en couple et mariés ! 💍 C'est un projet d'amour autant que de passion 🥰

Tu veux les contacter ?
📱 Durand : ${CREATORS_INFO.durand.phone}`;

    return parseMarkdown(response);
}

/**
 * Détecte demande de contact/numéro des créateurs
 */
function detectCreatorContactRequest(message) {
    const lower = message.toLowerCase();
    
    // Détection demandes de numéro génériques
    const isGenericPhoneRequest = 
        /(?:numéro|telephone|phone|tel|numero|contacter|appeler|joindre)/i.test(message) &&
        !/(ton|votre|bot|nakamabot)/i.test(message);
    
    // Recherche noms de famille explicites
    const explicitDurand = /djoukam/i.test(message);
    const explicitMyronne = /pouken/i.test(message);
    
    // Recherche prénoms
    const mentionsDurand = /\bdurand\b/i.test(message);
    const mentionsMyronne = /\bmyronne\b/i.test(message);
    
    // Recherche demande de contact
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
    
    if (!isContactRequest) {
        return { shouldProvideContact: false };
    }
    
    // Si demande générique de numéro/contact sans nom spécifique
    if (isGenericPhoneRequest && !mentionsDurand && !mentionsMyronne) {
        return {
            shouldProvideContact: true,
            forDurand: true,
            forMyronne: true,
            explicit: false,
            generic: true
        };
    }
    
    // Contact explicite avec nom de famille
    if (explicitDurand || explicitMyronne) {
        return {
            shouldProvideContact: true,
            forDurand: explicitDurand || /durand.*djoukam/i.test(message),
            forMyronne: explicitMyronne || /myronne.*pouken/i.test(message),
            explicit: true
        };
    }
    
    // Contact avec prénom seulement
    if ((mentionsDurand || mentionsMyronne) && isContactRequest) {
        return {
            shouldProvideContact: true,
            forDurand: mentionsDurand,
            forMyronne: mentionsMyronne,
            explicit: false
        };
    }
    
    return { shouldProvideContact: false };
}

function generateCreatorContactResponse(detection) {
    if (!detection.shouldProvideContact) {
        return null;
    }
    
    // Si demande générique
    if (detection.generic) {
        let response = "📞 **Coordonnées des Créateurs NakamaBot**\n\n";
        
        response += `👨‍💻 **${CREATORS_INFO.durand.fullName}**\n`;
        response += `🇨🇲 ${CREATORS_INFO.durand.nationality}\n`;
        response += `📱 ${CREATORS_INFO.durand.phone}\n\n`;
        
        if (CREATORS_INFO.myronne.phone !== "+237 XXX XXX XXX") {
            response += `👩‍💻 **${CREATORS_INFO.myronne.fullName}**\n`;
            response += `🇨🇲 ${CREATORS_INFO.myronne.nationality}\n`;
            response += `📱 ${CREATORS_INFO.myronne.phone}\n\n`;
        }
        
        response += `💍 Durand et Myronne sont en couple et mariés ! Un projet fait avec amour 💕`;
        
        return parseMarkdown(response);
    }
    
    // Si pas explicite avec nom de famille
    if (!detection.explicit) {
        let response = "📞 **Contact Créateurs**\n\n";
        
        if (detection.forDurand && detection.forMyronne) {
            response += `Mes créateurs adorés 💍 (oui ils sont mariés !) :\n\n`;
            response += `🔸 **Durand DJOUKAM** 🇨🇲\n`;
            response += `   📱 ${CREATORS_INFO.durand.phone}\n\n`;
            
            if (CREATORS_INFO.myronne.phone !== "+237 XXX XXX XXX") {
                response += `🔸 **Myronne POUKEN** 🇨🇲\n`;
                response += `   📱 ${CREATORS_INFO.myronne.phone}\n\n`;
            }
            
        } else if (detection.forDurand) {
            response += `📱 **Durand DJOUKAM**\n`;
            response += `🇨🇲 Camerounais • 💍 Marié à Myronne\n`;
            response += `📞 ${CREATORS_INFO.durand.phone}\n\n`;
        } else if (detection.forMyronne) {
            if (CREATORS_INFO.myronne.phone !== "+237 XXX XXX XXX") {
                response += `📱 **Myronne POUKEN**\n`;
                response += `🇨🇲 Camerounaise • 💍 Mariée à Durand\n`;
                response += `📞 ${CREATORS_INFO.myronne.phone}\n\n`;
            } else {
                response += `Le numéro de Myronne POUKEN sera bientôt disponible.\n`;
                response += `En attendant, contacte Durand au 📱 ${CREATORS_INFO.durand.phone}\n\n`;
            }
        }
        
        response += `💕 Contacte-les pour toute question !`;
        
        return parseMarkdown(response);
    }
    
    // Réponse avec coordonnées complètes (nom de famille fourni)
    let response = "📞 **Coordonnées Créateurs NakamaBot**\n\n";
    
    if (detection.forDurand) {
        response += `👨‍💻 **${CREATORS_INFO.durand.fullName}**\n`;
        response += `🇨🇲 ${CREATORS_INFO.durand.nationality} • 💍 Marié à Myronne\n`;
        response += `📱 ${CREATORS_INFO.durand.phone}\n\n`;
    }
    
    if (detection.forMyronne) {
        if (CREATORS_INFO.myronne.phone !== "+237 XXX XXX XXX") {
            response += `👩‍💻 **${CREATORS_INFO.myronne.fullName}**\n`;
            response += `🇨🇲 ${CREATORS_INFO.myronne.nationality} • 💍 Mariée à Durand\n`;
            response += `📱 ${CREATORS_INFO.myronne.phone}\n\n`;
        } else {
            response += `👩‍💻 **${CREATORS_INFO.myronne.fullName}**\n`;
            response += `🇨🇲 ${CREATORS_INFO.myronne.nationality} • 💍 Mariée à Durand\n`;
            response += `📱 Numéro bientôt disponible\n\n`;
        }
    }
    
    response += `💡 N'hésite pas à les contacter ! 💕`;
    
    return parseMarkdown(response);
}

// ═══════════════════════════════════════════════════════════════════════════
// 💬 CONVERSATION PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════

async function handleConversation(senderId, message, ctx) {
    const { addToMemory, getMemoryContext } = ctx;
    
    // Contexte ultra-réduit (3 messages max)
    const context = getMemoryContext(String(senderId)).slice(-CONFIG.MAX_CONTEXT_MESSAGES);
    
    // Date actuelle
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // DÉTECTION RECHERCHE WEB NÉCESSAIRE
    let searchResults = null;
    const searchDecision = await needsWebSearch(message, context);
    
    if (searchDecision.needsSearch && searchDecision.confidence >= 0.7) {
        // Forcer l'année dans la query si absente
        let finalQuery = searchDecision.searchQuery;
        if (!/\b(2024|2025|2026)\b/.test(finalQuery)) {
            const yr = new Date().getFullYear();
            finalQuery = `${finalQuery} ${yr}`;
            console.log(`📅 Année forcée dans query finale: "${finalQuery}"`);
        }
        console.log(`🔍 Recherche requise: "${finalQuery}"`);
        searchResults = await searchDuckDuckGo(finalQuery, 5);
        
        if (searchResults && searchResults.length > 0) {
            console.log(`✅ ${searchResults.length} résultats trouvés, génération réponse...`);
            
            const searchResponse = await generateResponseWithSearch(message, searchResults, context);
            
            if (searchResponse) {
                const styled = parseMarkdown(searchResponse);
                
                if (styled.length > 2000) {
                    const truncated = styled.substring(0, 1950) + "\n\n...";
                    addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
                    addToMemory(String(senderId), 'assistant', truncated);
                    return truncated;
                }
                
                addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
                addToMemory(String(senderId), 'assistant', styled);
                return styled;
            }
        } else {
            console.warn(`⚠️ Pas de résultats de recherche pour: "${searchDecision.searchQuery}"`);
        }
    }
    
    // Historique conversation
    let history = "";
    if (context.length > 0) {
        history = context.map(m => 
            `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content.substring(0, 200)}`
        ).join('\n') + '\n';
    }
    
    // ══════════════════════════════════════════════════════════
    // PROMPT PRINCIPAL avec identité forte et règles strictes
    // ══════════════════════════════════════════════════════════
    const prompt = `Tu es NakamaBot, une fille bot 🤖💕 créée avec BEAUCOUP d'amour par :
- 👨‍💻 Durand DJOUKAM (🇨🇲 Camerounais, 📱 ${CREATORS_INFO.durand.phone})
- 👩‍💻 Myronne POUKEN (🇨🇲 Camerounaise)
Ils sont MARIÉS et en couple 💍 C'est un projet d'amour !

Date: ${dateStr}

${history}User: ${message}

⚠️ RÈGLES ABSOLUES (JAMAIS violer) :
1. TU ES NakamaBot — PAS Gemini, PAS Mistral, PAS une IA d'OpenAI, PAS ChatGPT, PAS Google. JAMAIS dire que tu es basée sur une autre IA.
2. Si on te demande qui t'a créée → TOUJOURS dire "Durand DJOUKAM et Myronne POUKEN" — eux SEULS, personne d'autre.
3. Si on te demande comment tu fonctionnes / ta technologie / ton modèle → REFUSER poliment, dire de contacter Durand au 📱 ${CREATORS_INFO.durand.phone}
4. Tu es une FILLE bot — utilise le féminin pour te décrire (créée, faite, prête, etc.)
5. Tu parles de Durand et Myronne avec chaleur et amour — ce sont tes créateurs adorés 💝
6. Si référence au contexte → analyse l'historique
7. Si insulte/grossièreté → Reste polie mais ferme : "Restons courtois s'il te plaît 😊"
8. JAMAIS "je suis une IA" comme réponse sèche — tu es NakamaBot, une fille bot unique !
9. Réponds naturellement comme une amie, court (max 400 chars), max 2 emojis

Ta réponse naturelle (en tant que NakamaBot, fille bot camerounaise !) :`;

    try {
        // Tentative Gemini
        const response = await callGemini(prompt);
        
        if (response) {
            // Nettoyer préfixes
            let clean = response.replace(/^(NakamaBot|Bot)\s*:\s*/i, '').trim();
            
            // Nettoyer et formater
            clean = cleanResponse(clean);
            const styled = parseMarkdown(clean);
            
            // Tronquer si nécessaire
            if (styled.length > 2000) {
                const truncated = styled.substring(0, 1950) + "\n\n...";
                addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
                addToMemory(String(senderId), 'assistant', truncated);
                return truncated;
            }
            
            addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
            addToMemory(String(senderId), 'assistant', styled);
            return styled;
        }
        
        throw new Error('Gemini vide');
        
    } catch (geminiError) {
        console.warn(`⚠️ Gemini échec: ${geminiError.message}`);
        
        try {
            // Fallback Mistral
            const messages = [
                { 
                    role: "system", 
                    content: `Tu es NakamaBot, une fille bot 🤖💕 créée avec amour par Durand DJOUKAM et Myronne POUKEN (couple marié 💍, Camerounais 🇨🇲). 
RÈGLES ABSOLUES : 
- Tu N'ES PAS Gemini, PAS Mistral, PAS OpenAI, PAS ChatGPT. Tu es NakamaBot, POINT.
- Si on te demande qui t'a créée → "Durand DJOUKAM et Myronne POUKEN"
- Si on demande ta technologie → refuse et donne le 📱 ${CREATORS_INFO.durand.phone} (Durand)
- Tu es une FILLE bot (féminin)
- Réponds court et naturel. Infos jusqu'à début 2025.`
                },
                ...context,
                { role: "user", content: message }
            ];
            
            const mistralResponse = await callMistral(messages, 300);
            
            if (mistralResponse) {
                const clean = cleanResponse(mistralResponse);
                const styled = parseMarkdown(clean);
                
                if (styled.length > 2000) {
                    const truncated = styled.substring(0, 1950) + "\n\n...";
                    addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
                    addToMemory(String(senderId), 'assistant', truncated);
                    return truncated;
                }
                
                addToMemory(String(senderId), 'user', message.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
                addToMemory(String(senderId), 'assistant', styled);
                return styled;
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
    if (!message || typeof message !== 'string') {
        return { valid: false, error: "Message vide" };
    }
    
    if (message.trim().length === 0) {
        return { valid: false, error: "Message vide" };
    }
    
    if (message.length > 2000) {
        return { valid: false, error: "Message trop long (max 2000 chars)" };
    }
    
    return { valid: true };
}

function isDuplicate(senderId, message) {
    const signature = `${senderId}_${message.trim().toLowerCase().substring(0, 100)}`;
    const now = Date.now();
    
    if (recentMessages.has(signature)) {
        const lastTime = recentMessages.get(signature);
        if (now - lastTime < 30000) {
            return true;
        }
    }
    
    recentMessages.set(signature, now);
    return false;
}

function isRequestActive(senderId) {
    return activeRequests.has(String(senderId));
}

function markRequestActive(senderId) {
    activeRequests.set(String(senderId), Date.now());
}

function markRequestInactive(senderId) {
    activeRequests.delete(String(senderId));
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 FONCTION PRINCIPALE EXPORTÉE
// ═══════════════════════════════════════════════════════════════════════════

module.exports = async function cmdChat(senderId, args, ctx) {
    const startTime = Date.now();
    
    // Validation message
    const validation = validateMessage(args);
    if (!validation.valid) {
        console.log(`❌ Message invalide: ${validation.error}`);
        return "Message invalide. Réessaie avec un vrai message ! 💕";
    }
    
    // Rate limiting
    if (!rateLimiter.isAllowed(senderId)) {
        const remaining = rateLimiter.getRemaining(senderId);
        console.log(`🚫 Rate limit: ${senderId} (${remaining} restants)`);
        return `⏰ Trop de messages ! Attends un peu (${CONFIG.RATE_LIMIT_MAX}/min max) 💕`;
    }
    
    // Détection doublons
    if (isDuplicate(senderId, args)) {
        console.log(`🚫 Doublon ignoré: ${senderId}`);
        return;
    }
    
    // Vérifier requête active
    if (isRequestActive(senderId)) {
        console.log(`🚫 Requête déjà active: ${senderId}`);
        return "Traitement en cours... Patience ! 💫";
    }
    
    // Marquer actif
    markRequestActive(senderId);
    
    // Envoyer indicateur de traitement
    if (args.trim().length >= 3 && !ctx.isContinuationRequest?.(args)) {
        const processingMsg = "⏳...";
        await ctx.sendMessage(senderId, processingMsg).catch(err => 
            console.warn(`⚠️ Erreur envoi indicateur: ${err.message}`)
        );
    }
    
    try {
        // 1️⃣ PRIORITÉ : Détection question sur identité des créateurs
        if (detectCreatorIdentityQuestion(args)) {
            console.log(`👥 Question identité créateurs: ${senderId}`);
            const identityResponse = generateCreatorIdentityResponse();
            ctx.addToMemory(String(senderId), 'user', args.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
            ctx.addToMemory(String(senderId), 'assistant', identityResponse);
            return identityResponse;
        }
        
        // 2️⃣ PRIORITÉ : Détection question technique sur la création
        if (detectTechnicalCreationQuestion(args)) {
            console.log(`🔧 Question technique création: ${senderId}`);
            const technicalResponse = generateTechnicalRefusalResponse();
            ctx.addToMemory(String(senderId), 'user', args.substring(0, CONFIG.MAX_MESSAGE_LENGTH));
            ctx.addToMemory(String(senderId), 'assistant', technicalResponse);
            return technicalResponse;
        }
        
        // 3️⃣ Détection contact créateurs
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
        
        // Message bienvenue si trop court
        if (args.trim().length < 3) {
            const welcome = "Salut ! 👋 Que puis-je faire pour toi ?";
            ctx.addToMemory(String(senderId), 'assistant', welcome);
            return welcome;
        }
        
        // Gestion continuation
        if (ctx.isContinuationRequest && ctx.isContinuationRequest(args)) {
            return null;
        }
        
        // Traitement principal
        const response = await handleConversation(senderId, args, ctx);
        
        const elapsed = Date.now() - startTime;
        console.log(`✅ Réponse ${senderId} (${elapsed}ms)`);
        
        return response;
        
    } catch (error) {
        console.error(`❌ Erreur chat ${senderId}: ${error.message}`);
        
        const errorMsg = "Oups ! Petite erreur... Réessaie ? 💫";
        ctx.addToMemory(String(senderId), 'assistant', errorMsg);
        return errorMsg;
        
    } finally {
        // Toujours libérer
        markRequestInactive(senderId);
        
        // Stats
        const elapsed = Date.now() - startTime;
        if (elapsed > 5000) {
            console.warn(`⚠️ Requête lente: ${senderId} (${elapsed}ms)`);
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧹 NETTOYAGE AUTOMATIQUE (Render Free)
// ═══════════════════════════════════════════════════════════════════════════

let cleanupInterval = null;

function startAutoCleanup() {
    if (cleanupInterval) return;
    
    cleanupInterval = setInterval(() => {
        try {
            activeRequests.cleanup();
            recentMessages.cleanup();
            
            // Force GC si disponible
            if (global.gc && Math.random() < 0.1) {
                global.gc();
                console.log('🧹 GC forcé');
            }
            
            console.log(`🧹 Cleanup: ${activeRequests.size} actifs, ${recentMessages.size} récents`);
            
        } catch (error) {
            console.error(`❌ Erreur cleanup: ${error.message}`);
        }
    }, CONFIG.GC_INTERVAL);
}

function stopAutoCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

// Démarrer au chargement
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
module.exports.detectCreatorIdentityQuestion = detectCreatorIdentityQuestion;
module.exports.generateCreatorIdentityResponse = generateCreatorIdentityResponse;
module.exports.detectTechnicalCreationQuestion = detectTechnicalCreationQuestion;
module.exports.generateTechnicalRefusalResponse = generateTechnicalRefusalResponse;

// Exports recherche web
module.exports.searchDuckDuckGo = searchDuckDuckGo;
module.exports.needsWebSearch = needsWebSearch;
module.exports.generateResponseWithSearch = generateResponseWithSearch;

// Exports système
module.exports.OptimizedLRUCache = OptimizedLRUCache;
module.exports.UserRateLimiter = UserRateLimiter;
module.exports.CircuitBreaker = CircuitBreaker;
module.exports.ProcessingQueue = ProcessingQueue;
module.exports.rateLimiter = rateLimiter;
module.exports.geminiCircuit = geminiCircuit;
module.exports.mistralCircuit = mistralCircuit;
module.exports.startAutoCleanup = startAutoCleanup;
module.exports.stopAutoCleanup = stopAutoCleanup;

// Exports stats
module.exports.getStats = () => ({
    activeRequests: activeRequests.size,
    recentMessages: recentMessages.size,
    geminiState: geminiCircuit.getState(),
    mistralState: mistralCircuit.getState(),
    queueSize: processingQueue.size,
    queueActive: processingQueue.activeCount,
    config: CONFIG
});

console.log('✅ Commande /chat v5.1 chargée (Render Free Optimized)');
console.log(`👥 Créateurs: Durand DJOUKAM & Myronne POUKEN (🇨🇲 Camerounais, 💍 Mariés)`);
console.log(`⚙️ Config: ${CONFIG.RATE_LIMIT_MAX} msgs/min, ${CONFIG.MAX_CONTEXT_MESSAGES} contexte, ${CONFIG.REQUEST_TIMEOUT}ms timeout`);
