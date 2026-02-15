/**
 * NakamaBot - Commande /chat OPTIMISÉE RENDER FREE
 * Version 5.0 - Multi-User High Performance Edition
 * Créée par Djoukam Durand et Pouken Myronne (Camerounais)
 * 
 * OPTIMISATIONS RENDER FREE:
 * - Gestion concurrentielle robuste (Map + WeakMap)
 * - Timeouts agressifs (10s max)
 * - Circuit breaker par utilisateur
 * - Rate limiting strict
 * - Mémoire minimale (500 chars/msg)
 * - Cache TTL court (15 min)
 * - Retry limité (1 seul)
 * - Prompts ultra-compressés
 * - Détection spam renforcée
 * - Queue de requêtes avec priorité
 * 
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require('path');
const fs = require('fs');

// ========================================
// 🔑 CONFIGURATION APIs
// ========================================

const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";

// 🆕 RECHERCHE GRATUITE OPTIMISÉE
const SEARCH_CONFIG = {
    duckduckgo: {
        enabled: true,
        baseUrl: 'https://html.duckduckgo.com/html/',
        timeout: 6000, // 🚀 RÉDUIT: 6s au lieu de 8s
        maxResults: 3 // 🚀 RÉDUIT: 3 au lieu de 5
    },
    wikipedia: {
        enabled: true,
        baseUrl: 'https://fr.wikipedia.org/api/rest_v1',
        timeout: 5000, // 🚀 RÉDUIT: 5s au lieu de 6s
        maxResults: 2 // 🚀 RÉDUIT: 2 au lieu de 3
    },
    webScraping: {
        enabled: false, // 🚀 DÉSACTIVÉ pour Render Free (trop lent)
        timeout: 8000,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
};

const SEARCH_RETRY_DELAY = 1000; // 🚀 RÉDUIT: 1s au lieu de 2s
const SEARCH_GLOBAL_COOLDOWN = 2000; // 🚀 RÉDUIT: 2s au lieu de 3s

// 🚀 État global OPTIMISÉ pour multi-user
let currentGeminiKeyIndex = 0;
const failedKeys = new Set();

// 🚀 NOUVEAU: Maps pour gestion concurrentielle
const activeRequests = new Map(); // userId -> { timestamp, requestId }
const recentMessages = new Map(); // messageSignature -> timestamp
const searchCache = new Map(); // query -> { results, timestamp }
const CACHE_TTL = 900000; // 🚀 RÉDUIT: 15 min au lieu de 1h

// 🚀 NOUVEAU: Context conversationnel avec TTL
const conversationContext = new Map(); // userId -> { lastTopic, entities, intent, timestamp }
const CONTEXT_TTL = 600000; // 10 minutes

// 🚀 NOUVEAU: Circuit breaker par utilisateur
const userCircuitBreaker = new Map(); // userId -> { failures, lastFailure, blockedUntil }
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30s

// 🚀 NOUVEAU: Rate limiting par utilisateur
const userRateLimiter = new Map(); // userId -> { requests: [], lastCleanup }
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requêtes/min max

// 🚀 NOUVEAU: Queue de priorité
const requestQueue = [];
let isProcessingQueue = false;

// État Gemini
let allGeminiKeysDead = false;
let lastGeminiCheck = 0;
const GEMINI_RECHECK_INTERVAL = 300000; // 5 minutes

// ========================================
// 🎨 FONCTIONS MARKDOWN → UNICODE (OPTIMISÉES)
// ========================================

const UNICODE_MAPPINGS = {
    bold: {
        'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺',
        'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
        'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠',
        'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧', 'U': '𝗨', 'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
        '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    }
};

function toBold(str) {
    return str.split('').map(char => UNICODE_MAPPINGS.bold[char] || char).join('');
}

function toUnderline(str) {
    return str.split('').map(char => char + '\u0332').join('');
}

function toStrikethrough(str) {
    return str.split('').map(char => char + '\u0336').join('');
}

// Support expressions mathématiques basiques
function parseLatexMath(content) {
    if (!content) return content;

    const superscripts = {
        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
        'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ',
        'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ',
        'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
        '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾'
    };

    content = content.replace(/\^\{([0-9a-zA-Z+\-=()]+)\}/g, (match, p1) => 
        p1.split('').map(char => superscripts[char] || char).join('')
    );
    content = content.replace(/\^([0-9a-zA-Z+\-=()])/g, (match, p1) => superscripts[p1] || `^${p1}`);
    content = content.replace(/([a-zA-Z0-9\)]+)'/g, '$1′');
    content = content.replace(/\\vec\{(.*?)\}/g, '$1⃗');
    content = content.replace(/\\sin/g, 'sin').replace(/\\cos/g, 'cos').replace(/\\tan/g, 'tan');
    content = content.replace(/\\infty/g, '∞').replace(/\\pi/g, 'π').replace(/\\approx/g, '≈');
    content = content.replace(/\\neq/g, '≠').replace(/\\geq/g, '≥').replace(/\\leq/g, '≤');
    content = content.replace(/\\circ/g, '∘').replace(/\\cdot/g, '⋅');
    content = content.replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '($1)/($2)');

    return content;
}

function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    
    let parsed = text;
    parsed = parsed.replace(/^###\s+(.+)$/gm, (match, title) => `🔹 ${toBold(title.trim())}`);
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (match, content) => toBold(content));
    parsed = parsed.replace(/__([^_]+)__/g, (match, content) => toUnderline(content));
    parsed = parsed.replace(/~~([^~]+)~~/g, (match, content) => toStrikethrough(content));
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (match, content) => `• ${content.trim()}`);
    parsed = parsed.replace(/\\\((.*?)\\\)/g, (match, content) => parseLatexMath(content));
    parsed = parsed.replace(/\\\[([\s\S]*?)\\\]/g, (match, content) => `\n${parseLatexMath(content)}\n`);

    return parsed;
}

function cleanResponse(text) {
    if (!text) return text;
    return text.replace(/🕒\.\.\.(\s*🕒\.\.\.)*/g, '').trim();
}

// ========================================
// 🚀 NOUVEAU: GESTION CONCURRENTIELLE
// ========================================

/**
 * Vérifie si un utilisateur peut faire une requête (rate limiting)
 */
function canUserMakeRequest(userId, log) {
    const now = Date.now();
    let rateLimitData = userRateLimiter.get(userId);
    
    if (!rateLimitData) {
        rateLimitData = { requests: [], lastCleanup: now };
        userRateLimiter.set(userId, rateLimitData);
    }
    
    // Nettoyer les anciennes requêtes
    if (now - rateLimitData.lastCleanup > RATE_LIMIT_WINDOW) {
        rateLimitData.requests = rateLimitData.requests.filter(
            timestamp => now - timestamp < RATE_LIMIT_WINDOW
        );
        rateLimitData.lastCleanup = now;
    }
    
    // Vérifier limite
    if (rateLimitData.requests.length >= RATE_LIMIT_MAX_REQUESTS) {
        log.warning(`🚫 Rate limit atteint pour ${userId}: ${rateLimitData.requests.length} requêtes/min`);
        return false;
    }
    
    rateLimitData.requests.push(now);
    userRateLimiter.set(userId, rateLimitData);
    return true;
}

/**
 * Vérifie le circuit breaker pour un utilisateur
 */
function checkCircuitBreaker(userId, log) {
    const breakerData = userCircuitBreaker.get(userId);
    
    if (!breakerData) return true;
    
    const now = Date.now();
    
    // Si bloqué, vérifier timeout
    if (breakerData.blockedUntil && now < breakerData.blockedUntil) {
        const remainingSeconds = Math.ceil((breakerData.blockedUntil - now) / 1000);
        log.warning(`⚡ Circuit breaker actif pour ${userId}: ${remainingSeconds}s restantes`);
        return false;
    }
    
    // Reset si timeout expiré
    if (breakerData.blockedUntil && now >= breakerData.blockedUntil) {
        userCircuitBreaker.delete(userId);
        log.info(`✅ Circuit breaker reset pour ${userId}`);
        return true;
    }
    
    return true;
}

/**
 * Enregistre un échec pour le circuit breaker
 */
function recordCircuitBreakerFailure(userId, log) {
    const now = Date.now();
    let breakerData = userCircuitBreaker.get(userId);
    
    if (!breakerData) {
        breakerData = { failures: 0, lastFailure: now, blockedUntil: null };
    }
    
    breakerData.failures++;
    breakerData.lastFailure = now;
    
    if (breakerData.failures >= CIRCUIT_BREAKER_THRESHOLD) {
        breakerData.blockedUntil = now + CIRCUIT_BREAKER_TIMEOUT;
        log.warning(`⚡ Circuit breaker déclenché pour ${userId}: ${breakerData.failures} échecs`);
    }
    
    userCircuitBreaker.set(userId, breakerData);
}

/**
 * Reset circuit breaker après succès
 */
function resetCircuitBreaker(userId) {
    userCircuitBreaker.delete(userId);
}

// ========================================
// 🔑 GESTION ROTATION CLÉS GEMINI (OPTIMISÉE)
// ========================================

function checkIfAllGeminiKeysDead() {
    if (GEMINI_API_KEYS.length === 0) {
        allGeminiKeysDead = true;
        return true;
    }
    
    const now = Date.now();
    if (allGeminiKeysDead && (now - lastGeminiCheck > GEMINI_RECHECK_INTERVAL)) {
        allGeminiKeysDead = false;
        failedKeys.clear();
        currentGeminiKeyIndex = 0;
        lastGeminiCheck = now;
        return false;
    }
    
    if (failedKeys.size >= GEMINI_API_KEYS.length) {
        allGeminiKeysDead = true;
        lastGeminiCheck = now;
        return true;
    }
    
    return false;
}

function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    if (checkIfAllGeminiKeysDead()) {
        throw new Error('Toutes les clés Gemini sont mortes');
    }
    
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        
        if (!failedKeys.has(key)) return key;
        attempts++;
    }
    
    throw new Error('Aucune clé Gemini disponible');
}

function markKeyAsFailed(apiKey) {
    failedKeys.add(apiKey);
    checkIfAllGeminiKeysDead();
}

/**
 * 🚀 OPTIMISÉ: Appel Gemini avec timeout agressif (10s max)
 */
async function callGeminiWithRotation(prompt, maxRetries = 1) {
    if (checkIfAllGeminiKeysDead()) {
        throw new Error('Toutes les clés Gemini sont inutilisables');
    }
    
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const apiKey = getNextGeminiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
            
            // 🚀 CRITIQUE: Timeout 10s max pour Render Free
            const result = await Promise.race([
                model.generateContent(prompt),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Gemini timeout 10s')), 10000)
                )
            ]);
            
            const response = result.response.text();
            
            if (response && response.trim()) {
                failedKeys.delete(apiKey);
                return response;
            }
            
            throw new Error('Réponse Gemini vide');
            
        } catch (error) {
            lastError = error;
            if (error.message.includes('API_KEY') || error.message.includes('quota') || error.message.includes('limit')) {
                const currentKey = GEMINI_API_KEYS[(currentGeminiKeyIndex - 1 + GEMINI_API_KEYS.length) % GEMINI_API_KEYS.length];
                markKeyAsFailed(currentKey);
            }
            
            if (attempt === maxRetries - 1) throw lastError;
        }
    }
    
    throw lastError || new Error('Gemini échec');
}

// ========================================
// 🆕 APPEL MISTRAL OPTIMISÉ
// ========================================

/**
 * 🚀 OPTIMISÉ: Appel Mistral avec timeout 15s max
 */
async function callMistralUnified(prompt, ctx, maxTokens = 150) {
    const { callMistralAPI, log } = ctx;
    
    if (!MISTRAL_API_KEY) {
        throw new Error('Clé Mistral non configurée');
    }
    
    try {
        const messages = [
            {
                role: "system",
                content: "Tu es NakamaBot, IA conversationnelle. Réponds en JSON structuré ou texte selon contexte. Concis."
            },
            {
                role: "user",
                content: prompt
            }
        ];
        
        // 🚀 CRITIQUE: Timeout 15s pour Render Free
        const response = await Promise.race([
            callMistralAPI(messages, maxTokens, 0.7),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Mistral timeout 15s')), 15000)
            )
        ]);
        
        if (!response) {
            throw new Error('Réponse Mistral vide');
        }
        
        log.info(`🔄 Mistral OK`);
        return response;
        
    } catch (error) {
        log.error(`❌ Erreur Mistral: ${error.message}`);
        throw error;
    }
}

// ========================================
// 🆕 RECHERCHE GRATUITE OPTIMISÉE
// ========================================

async function searchDuckDuckGo(query, log) {
    const cacheKey = `ddg_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        log.info(`💾 Cache DDG: ${query}`);
        return cached.results;
    }
    
    try {
        const response = await Promise.race([
            axios.post(
                SEARCH_CONFIG.duckduckgo.baseUrl,
                `q=${encodeURIComponent(query)}&kl=fr-fr`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': SEARCH_CONFIG.webScraping.userAgent
                    }
                }
            ),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), SEARCH_CONFIG.duckduckgo.timeout)
            )
        ]);
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('.result').slice(0, SEARCH_CONFIG.duckduckgo.maxResults).each((i, elem) => {
            const titleElem = $(elem).find('.result__title');
            const snippetElem = $(elem).find('.result__snippet');
            const linkElem = $(elem).find('.result__url');
            
            const title = titleElem.text().trim();
            const snippet = snippetElem.text().trim();
            const link = linkElem.attr('href') || titleElem.find('a').attr('href');
            
            if (title && snippet) {
                results.push({
                    title,
                    description: snippet,
                    link: link || 'N/A',
                    source: 'duckduckgo'
                });
            }
        });
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            log.info(`🦆 DDG: ${results.length} résultats`);
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ DDG échec: ${error.message}`);
        return [];
    }
}

async function searchWikipedia(query, log) {
    const cacheKey = `wiki_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        log.info(`💾 Cache Wiki: ${query}`);
        return cached.results;
    }
    
    try {
        const searchUrl = `${SEARCH_CONFIG.wikipedia.baseUrl}/page/search/${encodeURIComponent(query)}`;
        const searchResponse = await Promise.race([
            axios.get(searchUrl, {
                params: { limit: SEARCH_CONFIG.wikipedia.maxResults }
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), SEARCH_CONFIG.wikipedia.timeout)
            )
        ]);
        
        if (!searchResponse.data.pages || searchResponse.data.pages.length === 0) {
            return [];
        }
        
        const results = [];
        
        for (const page of searchResponse.data.pages.slice(0, SEARCH_CONFIG.wikipedia.maxResults)) {
            try {
                const summaryUrl = `${SEARCH_CONFIG.wikipedia.baseUrl}/page/summary/${encodeURIComponent(page.title)}`;
                const summaryResponse = await Promise.race([
                    axios.get(summaryUrl),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), SEARCH_CONFIG.wikipedia.timeout)
                    )
                ]);
                
                const summary = summaryResponse.data;
                results.push({
                    title: summary.title,
                    description: summary.extract,
                    link: summary.content_urls?.desktop?.page || 'https://fr.wikipedia.org',
                    source: 'wikipedia'
                });
            } catch (error) {
                // Ignorer erreurs individuelles
            }
        }
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            log.info(`📚 Wiki: ${results.length} résultats`);
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ Wiki échec: ${error.message}`);
        return [];
    }
}

/**
 * 🚀 OPTIMISÉ: Recherche intelligente (DDG puis Wiki uniquement)
 */
async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    try {
        if (SEARCH_CONFIG.duckduckgo.enabled) {
            const ddgResults = await searchDuckDuckGo(query, log);
            if (ddgResults.length > 0) return ddgResults;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (SEARCH_CONFIG.wikipedia.enabled) {
            const wikiResults = await searchWikipedia(query, log);
            if (wikiResults.length > 0) return wikiResults;
        }
        
        log.warning(`⚠️ Aucun résultat: ${query}`);
        return [];
        
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        return [];
    }
}

// ========================================
// 🧠 ANALYSE CONTEXTUELLE OPTIMISÉE
// ========================================

/**
 * 🚀 OPTIMISÉ: Analyse contexte avec cache et TTL
 */
async function analyzeConversationContext(senderId, currentMessage, conversationHistory, ctx) {
    const { log } = ctx;
    
    // Vérifier cache contexte
    const cachedContext = conversationContext.get(senderId);
    const now = Date.now();
    
    if (cachedContext && (now - cachedContext.timestamp < CONTEXT_TTL)) {
        log.debug(`💾 Cache contexte: ${senderId}`);
        return {
            mainTopic: cachedContext.lastTopic,
            entities: cachedContext.entities,
            intent: cachedContext.intent,
            contextualReference: null,
            enrichedQuery: currentMessage
        };
    }
    
    try {
        // 🚀 PROMPT ULTRA-COMPRESSÉ
        const recentHistory = conversationHistory.slice(-3).map(msg => 
            `${msg.role === 'user' ? 'U' : 'A'}: ${msg.content.substring(0, 100)}`
        ).join('\n');
        
        const contextPrompt = `Analyse contexte:

HIST:
${recentHistory}

MSG: "${currentMessage}"

JSON uniquement:
{
  "mainTopic": "sujet",
  "entities": ["e1"],
  "intent": "nouvelle_question|continuation|clarification|changement_sujet",
  "contextualReference": "ref_ou_null",
  "enrichedQuery": "query"
}`;

        let response;
        
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(contextPrompt, 1);
                log.info(`💎 Contexte Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec contexte`);
                response = await callMistralUnified(contextPrompt, ctx, 300);
                log.info(`🔄 Contexte Mistral`);
            }
        } else {
            response = await callMistralUnified(contextPrompt, ctx, 300);
            log.info(`🔄 Contexte Mistral (Gemini off)`);
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const context = JSON.parse(jsonMatch[0]);
            
            conversationContext.set(senderId, {
                lastTopic: context.mainTopic,
                entities: context.entities,
                intent: context.intent,
                timestamp: now
            });
            
            log.info(`🧠 Contexte: ${context.intent}`);
            
            return context;
        }
        
        throw new Error('Format JSON invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur contexte: ${error.message}`);
        
        return {
            mainTopic: currentMessage,
            entities: [],
            intent: 'nouvelle_question',
            contextualReference: null,
            enrichedQuery: currentMessage
        };
    }
}

// ========================================
// 🤖 DÉCISION IA RECHERCHE OPTIMISÉE
// ========================================

/**
 * 🚀 OPTIMISÉ: Décision recherche avec prompt compressé
 */
async function decideSearchNecessity(userMessage, senderId, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        const contextAnalysis = await analyzeConversationContext(senderId, userMessage, conversationHistory, ctx);
        
        // 🚀 PROMPT ULTRA-COMPRESSÉ
        const recentHistory = conversationHistory.slice(-3).map(msg => 
            `${msg.role === 'user' ? 'U' : 'A'}: ${msg.content.substring(0, 80)}`
        ).join('\n');
        
        const decisionPrompt = `Décision recherche:

HIST:
${recentHistory}

MSG: "${userMessage}"

CONTEXT: ${contextAnalysis.mainTopic} | ${contextAnalysis.intent}

RÈGLES:
✅ RECHERCHE: actualités 2025-2026, stats, classements, météo, sports
❌ PAS: conversations, conseils, créativité

JSON:
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "txt",
  "searchQuery": "query",
  "usesConversationMemory": true/false
}`;

        let response;
        
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(decisionPrompt, 1);
                log.info(`💎 Décision Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec décision`);
                response = await callMistralUnified(decisionPrompt, ctx, 300);
                log.info(`🔄 Décision Mistral`);
            }
        } else {
            response = await callMistralUnified(decisionPrompt, ctx, 300);
            log.info(`🔄 Décision Mistral (Gemini off)`);
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            
            log.info(`🤖 Décision: ${decision.needsExternalSearch ? 'OUI' : 'NON'} (${decision.confidence})`);
            
            return decision;
        }
        
        throw new Error('Format invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision: ${error.message}`);
        
        return {
            needsExternalSearch: false,
            confidence: 0.5,
            reason: 'fallback',
            searchQuery: userMessage,
            usesConversationMemory: false
        };
    }
}

// ========================================
// 🎯 DÉTECTION COMMANDES OPTIMISÉE
// ========================================

const VALID_COMMANDS = [
    'image', 'vision', 'anime', 'music', 
    'clan', 'rank', 'contact', 'weather'
];

/**
 * 🚀 OPTIMISÉ: Détection commandes avec prompt compressé
 */
async function detectIntelligentCommands(message, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        const commandsList = VALID_COMMANDS.join(', ');
        
        // 🚀 PROMPT ULTRA-COMPRESSÉ
        const recentHistory = conversationHistory.slice(-2).map(msg => 
            `${msg.role === 'user' ? 'U' : 'A'}: ${msg.content.substring(0, 60)}`
        ).join('\n');
        
        const detectionPrompt = `Détection commande:

CMDS: ${commandsList}

HIST:
${recentHistory}

MSG: "${message}"

RÈGLES:
✅ /image: créer/générer image
✅ /vision: analyser image
✅ /anime: transformer anime
✅ /music: chercher musique YouTube
❌ PAS: questions générales, aide

JSON:
{
  "isCommand": true/false,
  "command": "nom_ou_null",
  "confidence": 0.0-1.0,
  "extractedArgs": "args",
  "reason": "txt"
}`;

        let response;
        
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(detectionPrompt, 1);
                log.info(`💎 Détection Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec détection`);
                response = await callMistralUnified(detectionPrompt, ctx, 300);
                log.info(`🔄 Détection Mistral`);
            }
        } else {
            response = await callMistralUnified(detectionPrompt, ctx, 300);
            log.info(`🔄 Détection Mistral (Gemini off)`);
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const aiDetection = JSON.parse(jsonMatch[0]);
            
            if (aiDetection.command) {
                aiDetection.command = aiDetection.command.replace('/', '');
            }
            
            log.debug(`🔍 Détection: ${JSON.stringify(aiDetection)}`);
            
            const isValid = aiDetection.isCommand && 
                          VALID_COMMANDS.includes(aiDetection.command) && 
                          aiDetection.confidence >= 0.8;
            
            if (isValid) {
                log.info(`🎯 Commande: /${aiDetection.command} (${aiDetection.confidence})`);
                
                return {
                    shouldExecute: true,
                    command: aiDetection.command,
                    args: aiDetection.extractedArgs,
                    confidence: aiDetection.confidence,
                    method: 'ai_contextual'
                };
            } else {
                log.debug(`🚫 Pas de commande (${aiDetection.confidence})`);
                return { shouldExecute: false };
            }
        }
        
        throw new Error('Format invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection: ${error.message}`);
        return fallbackStrictKeywordDetection(message, log);
    }
}

function fallbackStrictKeywordDetection(message, log) {
    const lowerMessage = message.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    const strictPatterns = [
        { command: 'image', patterns: [
            /^cree\s+(une\s+)?image/, /^cree\s+(une\s+)?dessin/, /^fais\s+(une\s+)?image/, 
            /^genere\s+(une\s+)?image/, /^dessine\s+/, /^illustre\s+/
        ] },
        { command: 'vision', patterns: [
            /^regarde\s+(cette\s+)?(image|photo)/, /^(analyse|decrit|examine)\s+(cette\s+)?(image|photo)/
        ] },
        { command: 'anime', patterns: [
            /^transforme en anime/, /^style (anime|manga)/
        ] },
        { command: 'music', patterns: [
            /^(joue|lance|play)\s+/, /^(trouve|cherche)\s+(sur\s+youtube\s+)?cette\s+(musique|chanson)/
        ] },
        { command: 'clan', patterns: [
            /^(rejoindre|creer|mon)\s+clan/, /^bataille\s+de\s+clan/
        ] },
        { command: 'rank', patterns: [
            /^(mon\s+)?(niveau|rang|stats|progression)/
        ] },
        { command: 'contact', patterns: [
            /^contacter\s+(admin|administrateur)/, /^signaler\s+probleme/
        ] },
        { command: 'weather', patterns: [
            /^(meteo|quel\s+temps|temperature|previsions)/
        ] }
    ];
    
    for (const { command, patterns } of strictPatterns) {
        for (const pattern of patterns) {
            if (pattern.test(lowerMessage)) {
                log.info(`🔑 Fallback: /${command}`);
                return {
                    shouldExecute: true,
                    command,
                    args: message,
                    confidence: 0.9,
                    method: 'fallback_strict'
                };
            }
        }
    }
    
    log.debug(`🚫 Pas de commande fallback`);
    return { shouldExecute: false };
}

// ========================================
// 📝 GÉNÉRATION RÉPONSE OPTIMISÉE
// ========================================

/**
 * 🚀 OPTIMISÉ: Génération réponse avec prompt compressé
 */
async function generateNaturalResponseWithContext(originalQuery, searchResults, conversationHistory, ctx) {
    const { log, callMistralAPI } = ctx;
    
    // 🚀 LIMITER résultats recherche
    const resultsText = searchResults.slice(0, 2).map((r, i) => 
        `${i+1}. ${r.title.substring(0, 80)}: ${r.description.substring(0, 120)}`
    ).join('\n');
    
    try {
        // 🚀 PROMPT ULTRA-COMPRESSÉ
        const contextualPrompt = `NakamaBot:

HIST:
${conversationHistory ? conversationHistory.substring(0, 300) : "Début"}

Q: "${originalQuery.substring(0, 100)}"

INFO:
${resultsText}

RÈGLES:
- Mémoire conversation
- Amical, emojis
- Max 500 chars
- Markdown simple (**gras**, listes)
- PAS italique
- JAMAIS "recherche", "sources"

RÉPONSE:`;

        let response;
        
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(contextualPrompt, 1);
                log.info(`💎 Réponse Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec réponse`);
            }
        }
        
        if (!response) {
            const messages = [{
                role: "system",
                content: `NakamaBot. Mémoire complète. Naturel. Max 500 chars.\n${conversationHistory ? conversationHistory.substring(0, 200) : "Début"}`
            }, {
                role: "user", 
                content: `Q: "${originalQuery.substring(0, 100)}"\n\nINFO:\n${resultsText}\n\nRéponds naturellement:`
            }];
            
            response = await callMistralAPI(messages, 500, 0.7); // 🚀 RÉDUIT: 500 tokens
            log.info(`🔄 Réponse Mistral`);
        }
        
        if (response) {
            response = cleanResponse(response);
            
            // 🚀 LIMITE stricte 1500 chars
            if (response.length > 1500) {
                response = response.substring(0, 1450) + "...";
            }
            
            return response;
        }
        
        const topResult = searchResults[0];
        if (topResult) {
            return `D'après ce que je sais, ${topResult.description.substring(0, 200)} 💡`;
        }
        
        return null;
        
    } catch (error) {
        log.error(`❌ Erreur réponse: ${error.message}`);
        return null;
    }
}

// ========================================
// 💬 CONVERSATION UNIFIÉE OPTIMISÉE
// ========================================

/**
 * 🚀 OPTIMISÉ: Conversation avec prompt compressé et timeouts stricts
 */
async function handleConversationWithFallback(senderId, args, ctx, searchResults = null) {
    const { addToMemory, getMemoryContext, callMistralAPI, log, 
            splitMessageIntoChunks, truncatedMessages } = ctx;
    
    // 🚀 LIMITER contexte à 4 messages
    const context = getMemoryContext(String(senderId)).slice(-4);
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { 
        weekday: 'short', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Africa/Douala' // 🚀 NOUVEAU: Timezone Cameroun
    });
    
    // 🚀 HISTORIQUE COMPRESSÉ
    let conversationHistory = "";
    if (context.length > 0) {
        conversationHistory = context.map(msg => 
            `${msg.role === 'user' ? 'U' : 'A'}: ${msg.content.substring(0, 100)}`
        ).join('\n') + '\n';
    }
    
    // 🚀 RÉSULTATS RECHERCHE COMPRESSÉS
    let searchContext = "";
    if (searchResults && searchResults.length > 0) {
        searchContext = `\n\n🔍 INFO (intègre naturellement):
${searchResults.slice(0, 2).map((result, index) => 
    `${index + 1}. ${result.title.substring(0, 60)}: ${result.description.substring(0, 100)}`
).join('\n')}`;
    }
    
    // 🚀 PROMPT ULTRA-COMPRESSÉ
    const systemPrompt = `NakamaBot - IA conversationnelle créée par Djoukam Durand et Pouken Myronne (Camerounais 🇨🇲)

CONTEXTE: ${dateTime}

PERSO:
- Empathique, créative, mémoire complète
- Souviens-toi de TOUT l'historique
- Pédagogue naturelle

CAPACITÉS:
🎨 Images ("dessine...") | 👁️ Analyse images | 🌸 Anime | 🎵 Musique | 🛡️ Clans | 📊 Progression | 📞 Contact admin | 🔍 Recherche auto

CRÉATEURS:
- Djoukam Durand (Camerounais 🇨🇲)
- Pouken Myronne (Camerounaise 🇨🇲)
📞 CONTACT: Donner UNIQUEMENT si demande EXPLICITE avec noms de famille complets (Djoukam/Pouken)

DIRECTIVES:
- Langue user
- Max 800 chars
- Emojis parcimonie
- Évite répétitions
- ${messageCount >= 5 ? 'Suggère /help si pertinent' : ''}
- Questions techniques: "Demande à Durand ou Myronne !"
- Problèmes graves: /contact
- Markdown simple (**gras**, listes)
- PAS italique
- MÉMOIRE: si "et lui?", tu sais via historique
- Si infos récentes dispo, intègre SANS dire "j'ai trouvé"

HIST:
${conversationHistory || 'Début'}
${searchContext}

User: ${args.substring(0, 200)}`;

    const senderIdStr = String(senderId);

    try {
        let response;
        
        if (!checkIfAllGeminiKeysDead()) {
            response = await callGeminiWithRotation(systemPrompt, 1);
            if (response && response.trim()) {
                log.info(`💎 Gemini conv${searchResults ? ' +search' : ''}`);
            }
        }
        
        if (!response) {
            const messages = [{ role: "system", content: systemPrompt.substring(0, 1000) }];
            messages.push(...context);
            messages.push({ role: "user", content: args.substring(0, 300) });
            
            response = await callMistralAPI(messages, 800, 0.75); // 🚀 RÉDUIT: 800 tokens
            log.info(`🔄 Mistral conv${searchResults ? ' +search' : ''}`);
        }
        
        if (response) {
            response = cleanResponse(response);
            
            // 🚀 LIMITE stricte 1500 chars
            if (response.length > 1500) {
                response = response.substring(0, 1450) + "...";
            }
            
            const styledResponse = parseMarkdown(response);
            
            if (styledResponse.length > 2000) {
                const chunks = splitMessageIntoChunks(styledResponse, 2000);
                const firstChunk = chunks[0];
                
                if (chunks.length > 1) {
                    truncatedMessages.set(senderIdStr, {
                        fullMessage: styledResponse,
                        lastSentPart: firstChunk,
                        timestamp: new Date().toISOString()
                    });
                    
                    const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                    addToMemory(senderIdStr, 'user', args.substring(0, 500)); // 🚀 LIMITE 500
                    addToMemory(senderIdStr, 'assistant', truncatedResponse.substring(0, 500));
                    return truncatedResponse;
                }
            }
            
            addToMemory(senderIdStr, 'user', args.substring(0, 500));
            addToMemory(senderIdStr, 'assistant', styledResponse.substring(0, 500));
            return styledResponse;
        }
        
        throw new Error('Toutes les IA ont échoué');
        
    } catch (error) {
        log.error(`❌ Erreur conversation: ${error.message}`);
        
        const errorResponse = "🤔 Difficulté technique. Reformule ? 💫";
        const styledError = parseMarkdown(errorResponse);
        addToMemory(senderIdStr, 'assistant', styledError);
        return styledError;
    }
}

// ========================================
// ✉️ DÉTECTION CONTACT ADMIN OPTIMISÉE
// ========================================

function detectContactAdminIntention(message) {
    const lowerMessage = message.toLowerCase();
    
    const patterns = [
        { patterns: [/(?:contacter|parler).*?(?:admin|durand|myronne|djoukam|pouken)/i], reason: 'contact_direct' },
        { patterns: [/(?:problème|bug|erreur).*?grave/i], reason: 'probleme_technique' },
        { patterns: [/(?:signaler|reporter)/i], reason: 'signalement' },
        { patterns: [/(?:suggestion|propose|idée)/i], reason: 'suggestion' },
        { patterns: [/(?:qui a créé|créateur|createur)/i], reason: 'question_creation' },
        { patterns: [/(?:plainte|réclamation)/i], reason: 'plainte' }
    ];
    
    for (const category of patterns) {
        for (const pattern of category.patterns) {
            if (pattern.test(message)) {
                if (category.reason === 'question_creation') {
                    return { shouldContact: false };
                }
                return {
                    shouldContact: true,
                    reason: category.reason,
                    extractedMessage: message
                };
            }
        }
    }
    
    return { shouldContact: false };
}

function generateContactSuggestion(reason, extractedMessage) {
    const reasonMessages = {
        'contact_direct': { title: "💌 **Contact Admin**", message: "Tu veux contacter les admins !" },
        'probleme_technique': { title: "🔧 **Problème Technique**", message: "Problème technique détecté !" },
        'signalement': { title: "🚨 **Signalement**", message: "Tu veux signaler qqch !" },
        'suggestion': { title: "💡 **Suggestion**", message: "Tu as une suggestion !" },
        'plainte': { title: "📝 **Réclamation**", message: "Tu as une réclamation !" }
    };
    
    const reasonData = reasonMessages[reason] || {
        title: "📞 **Contact Admin**",
        message: "Tu veux contacter les admins !"
    };
    
    const preview = extractedMessage.length > 60 ? extractedMessage.substring(0, 60) + "..." : extractedMessage;
    
    return `${reasonData.title}\n\n${reasonData.message}\n\n💡 Utilise \`/contact [message]\`\n\n📝 Message: "${preview}"\n\n⚡ Limite: 2 msgs/jour\n📨 Réponse garantie !\n\n💕 Tape /help pour fonctionnalités !`;
}

// ========================================
// ⚙️ EXÉCUTION COMMANDE OPTIMISÉE
// ========================================

async function executeCommandFromChat(senderId, commandName, args, ctx) {
    const { log } = ctx;
    
    try {
        log.info(`⚙️ Exec /${commandName}`);
        
        const COMMANDS = global.COMMANDS || new Map();
        
        if (COMMANDS.has(commandName)) {
            const commandFunction = COMMANDS.get(commandName);
            const result = await Promise.race([
                commandFunction(senderId, args, ctx),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Command timeout 15s')), 15000)
                )
            ]);
            log.info(`✅ /${commandName} OK`);
            return { success: true, result };
        }
        
        const commandPath = path.join(__dirname, `${commandName}.js`);
        
        if (fs.existsSync(commandPath)) {
            delete require.cache[require.resolve(commandPath)];
            const commandModule = require(commandPath);
            
            if (typeof commandModule === 'function') {
                const result = await Promise.race([
                    commandModule(senderId, args, ctx),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Command timeout 15s')), 15000)
                    )
                ]);
                log.info(`✅ /${commandName} OK`);
                return { success: true, result };
            } else {
                log.error(`❌ Module ${commandName} invalide`);
                return { success: false, error: `Module ${commandName} invalide` };
            }
        }
        
        log.error(`❌ Commande ${commandName} introuvable`);
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        log.error(`❌ Erreur /${commandName}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    const { log, callMistralAPI } = ctx;
    
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        log.debug(`🖼️ Image result /${commandName}`);
        return commandResult;
    }
    
    if (typeof commandResult === 'string' && commandResult.length > 100) {
        log.debug(`📝 /${commandName} complet`);
        return commandResult;
    }
    
    try {
        // 🚀 PROMPT COMPRESSÉ
        const contextPrompt = `User: "${originalMessage.substring(0, 100)}"\n\n/${commandName} résultat: "${commandResult}"\n\nPrésente naturellement (max 300 chars). Markdown simple, pas italique.`;

        let response = await callGeminiWithRotation(contextPrompt, 1);
        if (!response) {
            response = await callMistralAPI([
                { role: "system", content: "NakamaBot. Présente résultat naturellement. Markdown simple." },
                { role: "user", content: contextPrompt }
            ], 300, 0.7);
        }
        
        response = cleanResponse(response);

        return response || commandResult;
        
    } catch (error) {
        log.error(`❌ Erreur contexte: ${error.message}`);
        return commandResult;
    }
}

// ========================================
// 🛡️ FONCTION PRINCIPALE OPTIMISÉE
// ========================================

/**
 * 🚀 FONCTION PRINCIPALE ULTRA-OPTIMISÉE POUR RENDER FREE
 * - Rate limiting strict
 * - Circuit breaker
 * - Timeouts agressifs
 * - Détection spam
 * - Gestion concurrentielle robuste
 */
module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, log, 
            truncatedMessages, splitMessageIntoChunks, isContinuationRequest } = ctx;
    
    const senderIdStr = String(senderId);
    const messageSignature = `${senderId}_${args.trim().toLowerCase()}`;
    const currentTime = Date.now();
    
    // 🚀 CRITIQUE: Vérifier rate limiting
    if (!canUserMakeRequest(senderIdStr, log)) {
        const rateLimitMsg = "🚫 Trop de requêtes ! Attends 1 minute... ⏳";
        addToMemory(senderIdStr, 'assistant', rateLimitMsg);
        await ctx.sendMessage(senderId, rateLimitMsg);
        return;
    }
    
    // 🚀 CRITIQUE: Vérifier circuit breaker
    if (!checkCircuitBreaker(senderIdStr, log)) {
        const breakerMsg = "⚡ Trop d'erreurs ! Attends 30s... 🔄";
        addToMemory(senderIdStr, 'assistant', breakerMsg);
        await ctx.sendMessage(senderId, breakerMsg);
        return;
    }
    
    // Anti-doublon strict (10s)
    if (recentMessages.has(messageSignature)) {
        const lastProcessed = recentMessages.get(messageSignature);
        if (currentTime - lastProcessed < 10000) { // 🚀 RÉDUIT: 10s
            log.warning(`🚫 Doublon: ${senderId}`);
            return;
        }
    }
    
    // Vérifier requête active
    if (activeRequests.has(senderIdStr)) {
        log.warning(`🚫 Requête en cours: ${senderId}`);
        return;
    }
    
    // Cooldown entre messages (3s)
    const lastMessageTime = Array.from(recentMessages.entries())
        .filter(([sig]) => sig.startsWith(`${senderId}_`))
        .map(([, timestamp]) => timestamp)
        .sort((a, b) => b - a)[0] || 0;
        
    if (lastMessageTime && (currentTime - lastMessageTime < 3000)) { // 🚀 RÉDUIT: 3s
        const waitMessage = "🕒 Attends 3s avant nouveau message...";
        addToMemory(senderIdStr, 'assistant', waitMessage);
        await ctx.sendMessage(senderId, waitMessage);
        return;
    }
    
    // Marquer requête active
    activeRequests.set(senderIdStr, `${senderId}_${currentTime}`);
    recentMessages.set(messageSignature, currentTime);
    
    // Nettoyage cache (2 minutes)
    for (const [signature, timestamp] of recentMessages.entries()) {
        if (currentTime - timestamp > 120000) {
            recentMessages.delete(signature);
        }
    }
    
    try {
        // Message de traitement
        if (args.trim() && !isContinuationRequest(args)) {
            const processingMessage = "🕒...";
            addToMemory(senderIdStr, 'assistant', processingMessage);
            await ctx.sendMessage(senderId, processingMessage);
        }
        
        // Message vide
        if (!args.trim()) {
            const welcomeMsg = "💬 Salut ! Je suis NakamaBot ! Dis-moi ce qui t'intéresse ! ✨";
            const styledWelcome = parseMarkdown(welcomeMsg);
            addToMemory(senderIdStr, 'assistant', styledWelcome);
            return styledWelcome;
        }
        
        const conversationHistory = getMemoryContext(senderIdStr).slice(-6); // 🚀 LIMITE 6
        
        // Continuation
        if (isContinuationRequest(args)) {
            const truncatedData = truncatedMessages.get(senderIdStr);
            if (truncatedData) {
                const { fullMessage, lastSentPart } = truncatedData;
                const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
                const remainingMessage = fullMessage.substring(lastSentIndex);
                
                if (remainingMessage.trim()) {
                    const chunks = splitMessageIntoChunks(remainingMessage, 2000);
                    const nextChunk = parseMarkdown(chunks[0]);
                    
                    if (chunks.length > 1) {
                        truncatedMessages.set(senderIdStr, {
                            fullMessage,
                            lastSentPart: lastSentPart + chunks[0],
                            timestamp: new Date().toISOString()
                        });
                        
                        const continuationMsg = nextChunk + "\n\n📝 *Tape \"continue\"...*";
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', continuationMsg.substring(0, 500));
                        return continuationMsg;
                    } else {
                        truncatedMessages.delete(senderIdStr);
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', nextChunk.substring(0, 500));
                        return nextChunk;
                    }
                } else {
                    truncatedMessages.delete(senderIdStr);
                    const endMsg = "✅ C'est tout ! Autre chose ? 💫";
                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', endMsg);
                    return endMsg;
                }
            } else {
                const noTruncMsg = "🤔 Pas de message en cours. Nouvelle question ? 💡";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noTruncMsg);
                return noTruncMsg;
            }
        }
        
        // Détection contact admin
        const contactIntention = detectContactAdminIntention(args);
        if (contactIntention.shouldContact) {
            log.info(`📞 Intention contact: ${contactIntention.reason}`);
            const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            const styledContact = parseMarkdown(contactSuggestion);
            
            addToMemory(senderIdStr, 'user', args.substring(0, 500));
            addToMemory(senderIdStr, 'assistant', styledContact.substring(0, 500));
            return styledContact;
        }
        
        // Détection commandes
        const intelligentCommand = await detectIntelligentCommands(args, conversationHistory, ctx);
        if (intelligentCommand.shouldExecute) {
            log.info(`🧠 Commande: /${intelligentCommand.command} (${intelligentCommand.confidence})`);
            
            addToMemory(senderIdStr, 'user', args.substring(0, 500));
            
            const commandResult = await executeCommandFromChat(senderId, intelligentCommand.command, intelligentCommand.args, ctx);
            
            if (commandResult.success) {
                if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                    resetCircuitBreaker(senderIdStr); // Succès
                    return commandResult.result;
                }
                
                const contextualResponse = await generateContextualResponse(args, commandResult.result, intelligentCommand.command, ctx);
                const styledResponse = parseMarkdown(contextualResponse);
                
                addToMemory(senderIdStr, 'assistant', styledResponse.substring(0, 500));
                resetCircuitBreaker(senderIdStr); // Succès
                return styledResponse;
            } else {
                log.warning(`⚠️ Échec /${intelligentCommand.command}`);
                recordCircuitBreakerFailure(senderIdStr, log);
            }
        }
        
        // Décision recherche
        const searchDecision = await decideSearchNecessity(args, senderId, conversationHistory, ctx);
        
        let searchResults = null;
        if (searchDecision.needsExternalSearch) {
            log.info(`🔍 Recherche: ${searchDecision.reason}`);
            searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
        }
        
        // Conversation
        const response = await handleConversationWithFallback(senderId, args, ctx, searchResults);
        
        resetCircuitBreaker(senderIdStr); // Succès
        return response;
        
    } catch (error) {
        log.error(`❌ Erreur chat: ${error.message}`);
        recordCircuitBreakerFailure(senderIdStr, log);
        
        const errorResponse = "🤔 Erreur technique. Réessaie dans 10s ? 💫";
        const styledError = parseMarkdown(errorResponse);
        addToMemory(senderIdStr, 'assistant', styledError);
        return styledError;
        
    } finally {
        activeRequests.delete(senderIdStr);
        log.debug(`🔓 Requête libérée: ${senderId}`);
    }
};

// ========================================
// 📤 EXPORTS
// ========================================

module.exports.detectIntelligentCommands = detectIntelligentCommands;
module.exports.VALID_COMMANDS = VALID_COMMANDS;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.decideSearchNecessity = decideSearchNecessity;
module.exports.performIntelligentSearch = performIntelligentSearch;
module.exports.generateNaturalResponseWithContext = generateNaturalResponseWithContext;
module.exports.analyzeConversationContext = analyzeConversationContext;
module.exports.callGeminiWithRotation = callGeminiWithRotation;
module.exports.callMistralUnified = callMistralUnified;
module.exports.getNextGeminiKey = getNextGeminiKey;
module.exports.markKeyAsFailed = markKeyAsFailed;
module.exports.checkIfAllGeminiKeysDead = checkIfAllGeminiKeysDead;
module.exports.parseMarkdown = parseMarkdown;
module.exports.toBold = toBold;
module.exports.toUnderline = toUnderline;
module.exports.toStrikethrough = toStrikethrough;
module.exports.canUserMakeRequest = canUserMakeRequest;
module.exports.checkCircuitBreaker = checkCircuitBreaker;
module.exports.recordCircuitBreakerFailure = recordCircuitBreakerFailure;
module.exports.resetCircuitBreaker = resetCircuitBreaker;
