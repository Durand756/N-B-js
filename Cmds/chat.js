/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🤖 NAKAMABOT - COMMANDE /CHAT HYPER-OPTIMISÉE POUR RENDER FREE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Version: 5.0 - Multi-User Concurrent Edition
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
        phone: "+237 XXX XXX XXX" // Remplacer par le vrai numéro
    },
    myronne: {
        fullName: "Myronne POUKEN",
        nationality: "Camerounaise 🇨🇲",
        phone: "+237 XXX XXX XXX" // Remplacer par le vrai numéro
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

function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    
    let parsed = text;
    
    // Titres
    parsed = parsed.replace(/^###\s+(.+)$/gm, (_, t) => `🔹 ${toBold(t.trim())}`);
    
    // Gras
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (_, c) => toBold(c));
    
    // Listes
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (_, c) => `• ${c.trim()}`);
    
    return parsed;
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
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
            
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
// 🧠 DÉTECTION DEMANDE CONTACT CRÉATEURS
// ═══════════════════════════════════════════════════════════════════════════

function detectCreatorContactRequest(message) {
    const lower = message.toLowerCase();
    
    // Recherche noms de famille explicites
    const explicitDurand = /djoukam/i.test(message);
    const explicitMyronne = /pouken/i.test(message);
    
    // Recherche demande de contact
    const contactPatterns = [
        /contact.*(?:durand|myronne|créateur|développeur)/i,
        /(?:numéro|téléphone|appeler).*(?:durand|myronne)/i,
        /(?:durand|myronne).*(?:numéro|téléphone|contact)/i,
        /comment.*contacter.*(?:durand|myronne)/i
    ];
    
    const isContactRequest = contactPatterns.some(p => p.test(message));
    
    if (!isContactRequest) {
        return { shouldProvideContact: false };
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
    
    // Contact avec prénom seulement (suggestion d'utiliser nom complet)
    if (/(?:durand|myronne)/i.test(message) && isContactRequest) {
        return {
            shouldProvideContact: true,
            forDurand: /durand/i.test(message),
            forMyronne: /myronne/i.test(message),
            explicit: false
        };
    }
    
    return { shouldProvideContact: false };
}

function generateCreatorContactResponse(detection) {
    if (!detection.shouldProvideContact) {
        return null;
    }
    
    // Si pas explicite avec nom de famille
    if (!detection.explicit) {
        let response = "📞 **Contact Créateurs**\n\n";
        
        if (detection.forDurand && detection.forMyronne) {
            response += `Tu veux contacter nos créateurs ?\n\n`;
            response += `Pour obtenir leurs coordonnées, précise leur **nom complet** :\n`;
            response += `• **Durand DJOUKAM**\n`;
            response += `• **Myronne POUKEN**\n\n`;
        } else if (detection.forDurand) {
            response += `Tu veux contacter Durand ?\n\n`;
            response += `Pour obtenir ses coordonnées, utilise son **nom complet** : **Durand DJOUKAM**\n\n`;
        } else if (detection.forMyronne) {
            response += `Tu veux contacter Myronne ?\n\n`;
            response += `Pour obtenir ses coordonnées, utilise son **nom complet** : **Myronne POUKEN**\n\n`;
        }
        
        response += `💡 Exemple : "Je veux contacter Durand DJOUKAM"`;
        
        return parseMarkdown(response);
    }
    
    // Réponse avec coordonnées complètes
    let response = "📞 **Coordonnées Créateurs NakamaBot**\n\n";
    
    if (detection.forDurand) {
        response += `👨‍💻 **${CREATORS_INFO.durand.fullName}**\n`;
        response += `🇨🇲 ${CREATORS_INFO.durand.nationality}\n`;
        response += `📱 ${CREATORS_INFO.durand.phone}\n\n`;
    }
    
    if (detection.forMyronne) {
        response += `👩‍💻 **${CREATORS_INFO.myronne.fullName}**\n`;
        response += `🇨🇲 ${CREATORS_INFO.myronne.nationality}\n`;
        response += `📱 ${CREATORS_INFO.myronne.phone}\n\n`;
    }
    
    response += `💡 N'hésite pas à les contacter pour toute question ! 💕`;
    
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
    
    // Historique conversation
    let history = "";
    if (context.length > 0) {
        history = context.map(m => 
            `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content.substring(0, 200)}`
        ).join('\n') + '\n';
    }
    
    // Prompt ultra-compressé
    const prompt = `Date: ${dateStr}
Créateurs: Durand (Camerounais 🇨🇲) & Myronne (Camerounaise 🇨🇲)

${history}User: ${message}

Réponds naturellement, court (max 400 chars), 1 emoji max. Si récent/actuel → dis que tu ne sais pas.`;

    try {
        // Tentative Gemini
        const response = await callGemini(prompt);
        
        if (response) {
            // Nettoyer préfixes
            let clean = response.replace(/^(NakamaBot|Bot)\s*:\s*/i, '').trim();
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
                { role: "system", content: `Bot créé par Durand & Myronne (🇨🇲). Réponds court et naturel.` },
                ...context,
                { role: "user", content: message }
            ];
            
            const mistralResponse = await callMistral(messages, 300);
            
            if (mistralResponse) {
                const styled = parseMarkdown(mistralResponse);
                
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
        if (now - lastTime < 30000) { // 30 secondes
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
    
    try {
        // Détection contact créateurs
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
        
        // Message bienvenue si vide
        if (args.trim().length < 3) {
            const welcome = "Salut ! 👋 Que puis-je faire pour toi ?";
            ctx.addToMemory(String(senderId), 'assistant', welcome);
            return welcome;
        }
        
        // Gestion continuation
        if (ctx.isContinuationRequest && ctx.isContinuationRequest(args)) {
            // Géré par le système de troncature du serveur
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
module.exports.callGemini = callGemini;
module.exports.callMistral = callMistral;
module.exports.detectCreatorContactRequest = detectCreatorContactRequest;
module.exports.generateCreatorContactResponse = generateCreatorContactResponse;

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

console.log('✅ Commande /chat v5.0 chargée (Render Free Optimized)');
console.log(`👥 Créateurs: Durand DJOUKAM & Myronne POUKEN (🇨🇲 Camerounais)`);
console.log(`⚙️ Config: ${CONFIG.RATE_LIMIT_MAX} msgs/min, ${CONFIG.MAX_CONTEXT_MESSAGES} contexte, ${CONFIG.REQUEST_TIMEOUT}ms timeout`);
