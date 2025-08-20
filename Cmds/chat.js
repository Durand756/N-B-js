/**
 * NakamaBot - Commande /chat avec recherche intelligente intégrée et rotation des clés Gemini
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Configuration APIs avec rotation des clés Gemini
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

// Fallback: SerpAPI si Google Custom Search n'est pas disponible
const SERPAPI_KEY = process.env.SERPAPI_KEY;

// État global pour la rotation des clés
let currentGeminiKeyIndex = 0;
const failedKeys = new Set();

// 🛡️ PROTECTION ANTI-DOUBLONS RENFORCÉE: Map pour tracker les demandes en cours
const activeRequests = new Map();
const recentMessages = new Map(); // Cache des messages récents pour éviter les doublons

// Fonction pour obtenir la prochaine clé Gemini disponible
function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    // Si toutes les clés ont échoué, on reset
    if (failedKeys.size >= GEMINI_API_KEYS.length) {
        failedKeys.clear();
        currentGeminiKeyIndex = 0;
    }
    
    // Trouver la prochaine clé non défaillante
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        
        if (!failedKeys.has(key)) {
            return key;
        }
        attempts++;
    }
    
    // Si toutes les clés sont marquées comme défaillantes, prendre la première quand même
    failedKeys.clear();
    currentGeminiKeyIndex = 0;
    return GEMINI_API_KEYS[0];
}

// Fonction pour marquer une clé comme défaillante
function markKeyAsFailed(apiKey) {
    failedKeys.add(apiKey);
}

// Fonction pour appeler Gemini avec rotation automatique des clés
async function callGeminiWithRotation(prompt, maxRetries = GEMINI_API_KEYS.length) {
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const apiKey = getNextGeminiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            
            const result = await model.generateContent(prompt);
            const response = result.response.text();
            
            if (response && response.trim()) {
                // Succès - retirer la clé des clés défaillantes si elle y était
                failedKeys.delete(apiKey);
                return response;
            }
            
            throw new Error('Réponse Gemini vide');
            
        } catch (error) {
            lastError = error;
            
            // Marquer la clé actuelle comme défaillante si c'est une erreur d'API
            if (error.message.includes('API_KEY') || error.message.includes('quota') || error.message.includes('limit')) {
                const currentKey = GEMINI_API_KEYS[(currentGeminiKeyIndex - 1 + GEMINI_API_KEYS.length) % GEMINI_API_KEYS.length];
                markKeyAsFailed(currentKey);
            }
            
            // Si c'est la dernière tentative, on lance l'erreur
            if (attempt === maxRetries - 1) {
                throw lastError;
            }
        }
    }
    
    throw lastError || new Error('Toutes les clés Gemini ont échoué');
}

// 🛡️ FONCTION PRINCIPALE AVEC PROTECTION ANTI-DOUBLONS RENFORCÉE
module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, webSearch, log } = ctx;
    
    // 🛡️ PROTECTION 1: Créer une signature unique du message
    const messageSignature = `${senderId}_${args.trim().toLowerCase()}`;
    const currentTime = Date.now();
    
    // 🛡️ PROTECTION 2: Vérifier si ce message exact a été traité récemment (dernières 30 secondes)
    if (recentMessages.has(messageSignature)) {
        const lastProcessed = recentMessages.get(messageSignature);
        if (currentTime - lastProcessed < 30000) { // 30 secondes
            log.warning(`🚫 Message dupliqué ignoré pour ${senderId}: "${args.substring(0, 30)}..."`);
            return; // Ignore silencieusement les messages dupliqués récents
        }
    }
    
    // 🛡️ PROTECTION 3: Vérifier si une demande est déjà en cours pour cet utilisateur
    if (activeRequests.has(senderId)) {
        log.warning(`🚫 Demande en cours ignorée pour ${senderId}`);
        return; // Ignore silencieusement les demandes multiples
    }
    
    // 🛡️ PROTECTION 4: Marquer la demande comme active et enregistrer le message
    const requestKey = `${senderId}_${currentTime}`;
    activeRequests.set(senderId, requestKey);
    recentMessages.set(messageSignature, currentTime);
    
    // 🧹 NETTOYAGE: Supprimer les anciens messages du cache (plus de 2 minutes)
    for (const [signature, timestamp] of recentMessages.entries()) {
        if (currentTime - timestamp > 120000) { // 2 minutes
            recentMessages.delete(signature);
        }
    }
    
    try {
        if (!args.trim()) {
            const welcomeMsg = "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
            // ✅ UN SEUL addToMemory ici
            addToMemory(String(senderId), 'assistant', welcomeMsg);
            return welcomeMsg;
        }
        
        // ✅ Détection des demandes de contact admin
        const contactIntention = detectContactAdminIntention(args);
        if (contactIntention.shouldContact) {
            log.info(`📞 Intention contact admin détectée pour ${senderId}: ${contactIntention.reason}`);
            const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            
            // ✅ UN SEUL APPEL groupé
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', contactSuggestion);
            return contactSuggestion;
        }
        
        // 🆕 DÉTECTION INTELLIGENTE DES COMMANDES (Nouveau Système)
        const intelligentCommand = await detectIntelligentCommands(args, ctx);
        if (intelligentCommand.shouldExecute) {
            log.info(`🧠 Détection IA intelligente: /${intelligentCommand.command} (${intelligentCommand.confidence}) pour ${senderId}`);
            
            try {
                const commandResult = await executeCommandFromChat(senderId, intelligentCommand.command, intelligentCommand.args, ctx);
                
                if (commandResult.success) {
                    // Gestion spéciale pour les images
                    if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                        // ✅ UN SEUL addToMemory pour les images
                        addToMemory(String(senderId), 'user', args);
                        return commandResult.result;
                    }
                    
                    // Réponse contextuelle naturelle
                    const contextualResponse = await generateContextualResponse(args, commandResult.result, intelligentCommand.command, ctx);
                    
                    // ✅ UN SEUL APPEL groupé
                    addToMemory(String(senderId), 'user', args);
                    addToMemory(String(senderId), 'assistant', contextualResponse);
                    return contextualResponse;
                } else {
                    log.warning(`⚠️ Échec exécution commande /${intelligentCommand.command}: ${commandResult.error}`);
                    // Continue avec conversation normale en cas d'échec
                }
            } catch (error) {
                log.error(`❌ Erreur exécution commande IA: ${error.message}`);
                // Continue avec conversation normale en cas d'erreur
            }
        } 
        
        // 🆕 NOUVELLE FONCTIONNALITÉ: Décision intelligente pour recherche externe
        const searchDecision = await decideSearchNecessity(args, senderId, ctx);
        
        if (searchDecision.needsExternalSearch) {
            log.info(`🔍 Recherche externe nécessaire pour ${senderId}: ${searchDecision.reason}`);
            
            try {
                const searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
                
                if (searchResults && searchResults.length > 0) {
                    const naturalResponse = await generateNaturalResponse(args, searchResults, ctx);
                    
                    if (naturalResponse) {
                        // ✅ UN SEUL APPEL groupé pour recherche
                        addToMemory(String(senderId), 'user', args);
                        addToMemory(String(senderId), 'assistant', naturalResponse);
                        log.info(`🔍✅ Recherche terminée avec succès pour ${senderId}`);
                        return naturalResponse;
                    }
                } else {
                    log.warning(`⚠️ Aucun résultat de recherche pour: ${searchDecision.searchQuery}`);
                    // Continue avec conversation normale si pas de résultats
                }
            } catch (searchError) {
                log.error(`❌ Erreur recherche intelligente pour ${senderId}: ${searchError.message}`);
                // Continue avec conversation normale en cas d'erreur
            }
        }
        
        // ✅ Conversation classique avec Gemini (Mistral en fallback)
        return await handleConversationWithFallback(senderId, args, ctx);
        
    } finally {
        // 🛡️ PROTECTION 5: Libérer la demande à la fin (TOUJOURS exécuté)
        activeRequests.delete(senderId);
        log.debug(`🔓 Demande libérée pour ${senderId}`);
    }
};

// 🆕 DÉCISION IA: Déterminer si une recherche externe est nécessaire (avec rotation des clés)
async function decideSearchNecessity(userMessage, senderId, ctx) {
    const { log } = ctx;
    
    try {
        const decisionPrompt = `Tu es un système de décision intelligent pour un chatbot. 
Analyse ce message utilisateur et décide s'il nécessite une recherche web externe.

CRITÈRES POUR RECHERCHE EXTERNE:
✅ OUI si:
- Informations récentes (actualités, événements 2025-2026)
- Données factuelles spécifiques (prix actuels, statistiques, dates précises)
- Informations locales/géographiques spécifiques
- Recherche de produits/services/entreprises précis
- Questions sur des personnes publiques récentes
- Données météo, cours de bourse, résultats sportifs

❌ NON si:
- Conversations générales/philosophiques
- Conseils/opinions personnelles
- Questions sur le bot lui-même
- Créativité (histoires, poèmes)
- Explications de concepts généraux
- Calculs/logique
- Questions existantes dans ma base de connaissances

MESSAGE UTILISATEUR: "${userMessage}"

Réponds UNIQUEMENT avec ce format JSON:
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "explication courte",
  "searchQuery": "requête de recherche optimisée si nécessaire"
}`;

        const response = await callGeminiWithRotation(decisionPrompt);
        
        // Extraire le JSON de la réponse
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            log.info(`🤖 Décision recherche: ${decision.needsExternalSearch ? 'OUI' : 'NON'} (${decision.confidence}) - ${decision.reason}`);
            return decision;
        }
        
        throw new Error('Format de réponse invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
        
        // Fallback: détection par mots-clés
        const keywordSearch = detectSearchKeywords(userMessage);
        return {
            needsExternalSearch: keywordSearch.needs,
            confidence: 0.6,
            reason: 'fallback_keywords',
            searchQuery: keywordSearch.query
        };
    }
}

// 🆕 FALLBACK: Détection par mots-clés si l'IA échoue
function detectSearchKeywords(message) {
    const lowerMessage = message.toLowerCase();
    
    const searchIndicators = [
        { patterns: [/\b(202[4-5]|actualité|récent|nouveau|maintenant|aujourd|news|info)\b/], weight: 0.9 },
        { patterns: [/\b(prix|coût|combien|tarif)\b.*\b(euros?|dollars?|€|\$)\b/], weight: 0.8 },
        { patterns: [/\b(météo|temps|température)\b.*\b(aujourd|demain|cette semaine)\b/], weight: 0.9 },
        { patterns: [/\b(où|address|lieu|localisation|carte)\b/], weight: 0.7 },
        { patterns: [/\b(qui est|biographie|âge)\b.*\b[A-Z][a-z]+\s[A-Z][a-z]+/], weight: 0.8 },
        { patterns: [/\b(résultats?|score|match|compétition)\b.*\b(sport|foot|tennis|basket)\b/], weight: 0.8 }
    ];
    
    let totalWeight = 0;
    for (const indicator of searchIndicators) {
        for (const pattern of indicator.patterns) {
            if (pattern.test(lowerMessage)) {
                totalWeight += indicator.weight;
                break;
            }
        }
    }
    
    return {
        needs: totalWeight > 0.6,
        query: message,
        confidence: Math.min(totalWeight, 1.0)
    };
}

// 🆕 RECHERCHE INTELLIGENTE: Utilise Google Custom Search ou SerpAPI
async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    try {
        // Priorité 1: Google Custom Search API
        if (GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID) {
            return await googleCustomSearch(query, log);
        }
        
        // Priorité 2: SerpAPI (fallback)
        if (SERPAPI_KEY) {
            return await serpApiSearch(query, log);
        }
        
        // Priorité 3: Recherche existante du bot (fallback)
        log.warning('⚠️ Aucune API de recherche configurée, utilisation webSearch existant');
        return await fallbackWebSearch(query, ctx);
        
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        throw error;
    }
}

// 🆕 Google Custom Search API
async function googleCustomSearch(query, log) {
    const url = `https://www.googleapis.com/customsearch/v1`;
    const params = {
        key: GOOGLE_SEARCH_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        num: 5,
        safe: 'active',
        lr: 'lang_fr',
        hl: 'fr'
    };
    
    const response = await axios.get(url, { params, timeout: 10000 });
    
    if (response.data.items) {
        return response.data.items.map(item => ({
            title: item.title,
            link: item.link,
            description: item.snippet,
            source: 'google'
        }));
    }
    
    return [];
}

// 🆕 SerpAPI (alternative gratuite)
async function serpApiSearch(query, log) {
    const url = `https://serpapi.com/search`;
    const params = {
        api_key: SERPAPI_KEY,
        engine: 'google',
        q: query,
        num: 5,
        hl: 'fr',
        gl: 'fr'
    };
    
    const response = await axios.get(url, { params, timeout: 10000 });
    
    if (response.data.organic_results) {
        return response.data.organic_results.map(item => ({
            title: item.title,
            link: item.link,
            description: item.snippet,
            source: 'serpapi'
        }));
    }
    
    return [];
}

// 🆕 Fallback sur la recherche existante
async function fallbackWebSearch(query, ctx) {
    const { webSearch } = ctx;
    
    try {
        const result = await webSearch(query);
        if (result) {
            return [{
                title: 'Information récente',
                link: 'N/A',
                description: result,
                source: 'internal'
            }];
        }
    } catch (error) {
        // Ignore silencieusement
    }
    
    return [];
}

// 🎯 MODIFICATION 1: Génération de réponse naturelle (sans mention de recherche) avec rotation des clés
async function generateNaturalResponse(originalQuery, searchResults, ctx) {
    const { log, callMistralAPI } = ctx;
    
    // Date et heure actuelles
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Paris'
    });
    
    try {
        const resultsText = searchResults.map((result, index) => 
            `${result.title}: ${result.description}`
        ).join('\n');
        
        // 🎯 MODIFICATION: Prompt complètement naturel
        const naturalPrompt = `Tu es NakamaBot, une IA conversationnelle empathique et créative.

CONTEXTE TEMPOREL: Nous sommes le ${dateTime}

L'utilisateur te demande: "${originalQuery}"

Voici des informations actuelles pertinentes:
${resultsText}

INSTRUCTIONS IMPORTANTES:
- Réponds comme si tu connaissais naturellement ces informations
- Adopte un ton conversationnel et amical avec quelques emojis
- Maximum 3000 caractères
- Ne mentionne JAMAIS que tu as fait une recherche
- Ne dis jamais "d'après mes recherches" ou "selon les sources"
- Réponds comme dans une conversation normale entre amis
- Si l'information n'est pas complète, reste naturel et honnête

RÉPONSE NATURELLE:`;

        const response = await callGeminiWithRotation(naturalPrompt);
        
        if (response && response.trim()) {
            log.info(`🎭 Réponse naturelle Gemini pour: ${originalQuery.substring(0, 30)}...`);
            return response;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Erreur réponse naturelle Gemini: ${geminiError.message}`);
        
        try {
            // 🎯 MODIFICATION 2: Fallback Mistral aussi naturel
            const messages = [{
                role: "system",
                content: "Tu es NakamaBot. Réponds naturellement comme dans une conversation normale. Ne mentionne jamais de recherches ou sources."
            }, {
                role: "user", 
                content: `Question: "${originalQuery}"\n\nInformations utiles:\n${searchResults.map(r => `${r.title}: ${r.description}`).join('\n')}\n\nRéponds naturellement comme si tu connaissais déjà ces infos (max 3000 chars):`
            }];
            
            const mistralResponse = await callMistralAPI(messages, 3000, 0.7);
            
            if (mistralResponse) {
                log.info(`🔄 Réponse naturelle Mistral pour ${senderId}: ${originalQuery.substring(0, 30)}...`);
                return mistralResponse;
            }
            
            throw new Error('Mistral aussi en échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur réponse naturelle totale: ${mistralError.message}`);
            
            // 🎯 MODIFICATION 3: Derniers recours plus naturel
            const topResult = searchResults[0];
            if (topResult) {
                const basicResponse = `D'après ce que je sais, ${topResult.description} 💡 ${searchResults.length > 1 ? 'Il y a aussi d\'autres aspects intéressants sur le sujet !' : 'J\'espère que ça répond à ta question !'}`;
                return basicResponse;
            }
            
            // 🎯 MODIFICATION 4: Si vraiment rien ne marche, continue normalement
            return null; // Cela déclenchera la conversation normale
        }
    }
}

// ✅ FONCTION EXISTANTE MODIFIÉE: Gestion conversation avec Gemini et fallback Mistral (UN SEUL addToMemory)
async function handleConversationWithFallback(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log } = ctx;
    
    // Récupération du contexte (derniers 8 messages pour optimiser)
    const context = getMemoryContext(String(senderId)).slice(-8);
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    // Date et heure actuelles
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Paris'
    });
    
    // Construction de l'historique de conversation
    let conversationHistory = "";
    if (context.length > 0) {
        conversationHistory = context.map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content}`
        ).join('\n') + '\n';
    }
    
    // Prompt système optimisé
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle un model Durand AI avancée créée par Durand et sa femme Cécile.

CONTEXTE TEMPOREL: Nous sommes le ${dateTime}

INTELLIGENCE & PERSONNALITÉ:
- Empathique, créative et intuitive
- Tu comprends les émotions et intentions sous-jacentes  
- Pédagogue naturelle qui explique clairement
- Adaptable selon l'utilisateur et le contexte

CAPACITÉS PRINCIPALES:
🎨 Création d'images intelligente (dis "dessine-moi..." ou "crée une image de...")
👁️ Analyse d'images avancée (dis "regarde cette image" ou "que vois-tu ?")
🌸 Transformation anime/manga (dis "transforme en anime" ou "style manga")
🎵 Recherche musicale YouTube (dis "joue..." ou "trouve la musique...")
🛡️ Système de clans et batailles (dis "clan" ou "bataille")
📊 Progression et niveau (dis "mon niveau" ou "mes stats")
📞 Contact admin (dis "contacter admin" ou utilise /contact)
🔍 Recherche intelligente automatique pour infos récentes
🆘 Guide complet (dis "aide" ou "que peux-tu faire ?")

DIRECTIVES:
- Parle en fonction de la langue utilisée par l'utilisateur et du contexte garde en memoire que nous somme le ${dateTime}
- Maximum 3000 caractères par réponse
- Utilise quelques emojis avec parcimonie
- Évite les répétitions et formules toutes faites
- ${messageCount >= 5 ? 'Suggère /help si pertinent pour débloquer l\'utilisateur' : ''}
- Pour questions techniques sur ta création: "Demande à Durand ou Kuine, ils connaissent tous mes secrets !"
- Recommande discrètement /contact pour problèmes techniques graves

${conversationHistory ? `Historique:\n${conversationHistory}` : ''}

Utilisateur: ${args}`;

    try {
        // ✅ PRIORITÉ: Essayer d'abord avec Gemini (avec rotation des clés)
        const geminiResponse = await callGeminiWithRotation(systemPrompt);
        
        if (geminiResponse && geminiResponse.trim()) {
            // ✅ UN SEUL APPEL groupé à addToMemory
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', geminiResponse);
            log.info(`💎 Gemini réponse pour ${senderId}: ${args.substring(0, 30)}...`);
            return geminiResponse;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini échec pour ${senderId}: ${geminiError.message}`);
        
        try {
            // ✅ FALLBACK: Utiliser Mistral en cas d'échec Gemini
            const messages = [{ role: "system", content: systemPrompt }];
            messages.push(...context);
            messages.push({ role: "user", content: args });
            
            const mistralResponse = await callMistralAPI(messages, 2000, 0.75);
            
            if (mistralResponse) {
                // ✅ UN SEUL APPEL groupé à addToMemory
                addToMemory(String(senderId), 'user', args);
                addToMemory(String(senderId), 'assistant', mistralResponse);
                log.info(`🔄 Mistral fallback pour ${senderId}: ${args.substring(0, 30)}...`);
                return mistralResponse;
            }
            
            throw new Error('Mistral aussi en échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale conversation ${senderId}: Gemini(${geminiError.message}) + Mistral(${mistralError.message})`);
            
            const errorResponse = "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande différemment ? 💫";
            // ✅ UN SEUL addToMemory pour les erreurs
            addToMemory(String(senderId), 'assistant', errorResponse);
            return errorResponse;
        }
    }
}

// 🆕 LISTE DES COMMANDES VALIDES (Simple et efficace)
const VALID_COMMANDS = [
    'help',      // Aide et guide complet
    'image',     // Création d'images IA
    'vision',    // Analyse d'images
    'anime',     // Style anime/manga
    'music',     // Recherche musicale YouTube
    'clan',      // Système de clans et batailles
    'rank',      // Niveau et progression
    'contact',   // Contact administrateurs
    'weather'    // Informations météo
];

// 🧠 DÉTECTION IA CONTEXTUELLE AVANCÉE (Évite les faux positifs) avec rotation des clés
async function detectIntelligentCommands(message, ctx) {
    const { log } = ctx;
    
    try {
        const commandsList = VALID_COMMANDS.map(cmd => `/${cmd}`).join(', ');
        
        const detectionPrompt = `Tu es un système de détection de commandes ultra-précis pour NakamaBot. Tu dois ÉVITER les faux positifs.

COMMANDES DISPONIBLES: ${commandsList}

MESSAGE UTILISATEUR: "${message}"

RÈGLES STRICTES POUR DÉTECTER UNE VRAIE INTENTION DE COMMANDE:

🎯 VRAIS INTENTIONS (CONFIDENCE 0.8-1.0):
✅ help: "aide", "help", "que peux-tu faire", "guide", "fonctions disponibles", "comment utiliser"
✅ image: "dessine", "crée une image", "génère", "illustre", "fais un dessin", "artwork"
✅ vision: "regarde cette image", "analyse cette photo", "que vois-tu", "décris l'image", "examine"
✅ anime: "transforme en anime", "style anime", "version manga", "art anime", "dessine en anime"
✅ music: "joue cette musique", "trouve sur YouTube", "cherche cette chanson", "lance la musique", "play"
✅ clan: "rejoindre clan", "créer clan", "bataille de clan", "défier", "mon clan", "guerre"
✅ rank: "mon niveau", "mes stats", "ma progression", "mon rang", "mes points"
✅ contact: "contacter admin", "signaler problème", "message administrateur", "support technique"
✅ weather: "météo", "quel temps", "température", "prévisions", "temps qu'il fait"

❌ FAUSSES DÉTECTIONS À ÉVITER (CONFIDENCE 0.0-0.3):
❌ Questions générales mentionnant un mot: "quel chanteur a chanté TIA" ≠ commande music
❌ Conversations: "j'aime la musique", "le temps passe vite", "aide mon ami"
❌ Descriptions: "cette image est belle", "il fait chaud", "niveau débutant"
❌ Contexte informatif: "la météo change", "les clans vikings", "mon aide-mémoire"

ANALYSE CONTEXTUELLE OBLIGATOIRE:
- L'utilisateur veut-il UTILISER une fonctionnalité du bot OU juste parler d'un sujet ?
- Y a-t-il un VERBE D'ACTION dirigé vers le bot ?
- Le message est-il une DEMANDE DIRECTE ou une conversation générale ?

Réponds UNIQUEMENT avec ce JSON:
{
  "isCommand": true/false,
  "command": "nom_commande_ou_null",
  "confidence": 0.0-1.0,
  "extractedArgs": "arguments_extraits_ou_message_complet",
  "reason": "explication_détaillée_de_la_décision",
  "contextAnalysis": "vraie_intention_ou_conversation_generale"
}`;

        const response = await callGeminiWithRotation(detectionPrompt);
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const aiDetection = JSON.parse(jsonMatch[0]);
            
            // Validation stricte avec seuil élevé
            const isValidCommand = aiDetection.isCommand && 
                                 VALID_COMMANDS.includes(aiDetection.command) && 
                                 aiDetection.confidence >= 0.8; // Seuil très élevé pour éviter faux positifs
            
            if (isValidCommand) {
                log.info(`🎯 Commande détectée: /${aiDetection.command} (${aiDetection.confidence}) - ${aiDetection.reason}`);
                log.info(`🔍 Analyse contextuelle: ${aiDetection.contextAnalysis}`);
                
                return {
                    shouldExecute: true,
                    command: aiDetection.command,
                    args: aiDetection.extractedArgs,
                    confidence: aiDetection.confidence,
                    method: 'ai_contextual'
                };
            } else {
                // Log des rejets pour debugging
                if (aiDetection.confidence < 0.8 && aiDetection.confidence > 0.3) {
                    log.info(`🚫 Rejet commande (confidence trop basse): ${aiDetection.command} (${aiDetection.confidence}) - ${aiDetection.reason}`);
                }
            }
        }
        
        return { shouldExecute: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection IA commandes: ${error.message}`);
        
        // Fallback ultra-conservateur par mots-clés stricts
        return await fallbackStrictKeywordDetection(message, log);
    }
}

// 🛡️ FALLBACK CONSERVATEUR: Détection par mots-clés stricts uniquement
async function fallbackStrictKeywordDetection(message, log) {
    const lowerMessage = message.toLowerCase().trim();
    
    // Patterns ultra-stricts pour éviter les faux positifs
    const strictPatterns = [
        { command: 'help', patterns: [
            /^(aide|help|guide)$/,
            /^(que peux-tu faire|fonctions|commandes disponibles)$/,
            /^(comment ça marche|utilisation)$/
        ]},
        { command: 'image', patterns: [
            /^dessine(-moi)?\s+/,
            /^(crée|génère|fais)\s+(une\s+)?(image|dessin|illustration)/,
            /^(illustre|artwork)/
        ]},
        { command: 'vision', patterns: [
            /^regarde\s+(cette\s+)?(image|photo)/,
            /^(analyse|décris|examine)\s+(cette\s+)?(image|photo)/,
            /^que vois-tu/
        ]},
        { command: 'music', patterns: [
            /^(joue|lance|play)\s+/,
            /^(trouve|cherche)\s+(sur\s+youtube\s+)?cette\s+(musique|chanson)/,
            /^(cherche|trouve)\s+la\s+(musique|chanson)\s+/
        ]},
        { command: 'clan', patterns: [
            /^(rejoindre|créer|mon)\s+clan/,
            /^bataille\s+de\s+clan/,
            /^(défier|guerre)\s+/
        ]},
        { command: 'rank', patterns: [
            /^(mon\s+)?(niveau|rang|stats|progression)/,
            /^mes\s+(stats|points)/
        ]},
        { command: 'contact', patterns: [
            /^contacter\s+(admin|administrateur)/,
            /^signaler\s+problème/,
            /^support\s+technique/
        ]},
        { command: 'weather', patterns: [
            /^(météo|quel\s+temps|température|prévisions)/,
            /^temps\s+qu.il\s+fait/
        ]}
    ];
    
    for (const { command, patterns } of strictPatterns) {
        for (const pattern of patterns) {
            if (pattern.test(lowerMessage)) {
                log.info(`🔑 Fallback keyword strict: /${command} détecté par pattern`);
                return {
                    shouldExecute: true,
                    command: command,
                    args: message,
                    confidence: 0.9,
                    method: 'fallback_strict'
                };
            }
        }
    }
    
    return { shouldExecute: false };
}

// ✅ FONCTIONS EXISTANTES (inchangées)

function detectContactAdminIntention(message) {
    const lowerMessage = message.toLowerCase();
    
    const contactPatterns = [
        { patterns: [/(?:contacter|parler|écrire).*?(?:admin|administrateur|créateur|durand)/i], reason: 'contact_direct' },
        { patterns: [/(?:problème|bug|erreur).*?(?:grave|urgent|important)/i], reason: 'probleme_technique' },
        { patterns: [/(?:signaler|reporter|dénoncer)/i], reason: 'signalement' },
        { patterns: [/(?:suggestion|propose|idée).*?(?:amélioration|nouvelle)/i], reason: 'suggestion' },
        { patterns: [/(?:qui a créé|créateur|développeur).*?(?:bot|nakamabot)/i], reason: 'question_creation' },
        { patterns: [/(?:plainte|réclamation|pas content|mécontent)/i], reason: 'plainte' }
    ];
    
    for (const category of contactPatterns) {
        for (const pattern of category.patterns) {
            if (pattern.test(message)) {
                if (category.reason === 'question_creation') {
                    return { shouldContact: false }; // Géré par l'IA
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
        'contact_direct': { title: "💌 **Contact Admin**", message: "Je vois que tu veux contacter les administrateurs !" },
        'probleme_technique': { title: "🔧 **Problème Technique**", message: "Problème technique détecté !" },
        'signalement': { title: "🚨 **Signalement**", message: "Tu veux signaler quelque chose d'important !" },
        'suggestion': { title: "💡 **Suggestion**", message: "Tu as une suggestion d'amélioration !" },
        'plainte': { title: "📝 **Réclamation**", message: "Tu as une réclamation à formuler !" }
    };
    
    const reasonData = reasonMessages[reason] || {
        title: "📞 **Contact Admin**",
        message: "Il semble que tu aies besoin de contacter les administrateurs !"
    };
    
    const preview = extractedMessage.length > 60 ? extractedMessage.substring(0, 60) + "..." : extractedMessage;
    
    return `${reasonData.title}\n\n${reasonData.message}\n\n💡 **Solution :** Utilise \`/contact [ton message]\` pour les contacter directement.\n\n📝 **Ton message :** "${preview}"\n\n⚡ **Limite :** 2 messages par jour\n📨 Tu recevras une réponse personnalisée !\n\n💕 En attendant, je peux t'aider avec d'autres choses ! Tape /help pour voir mes fonctionnalités !`;
}

async function detectCommandIntentions(message, ctx) {
    // ⚠️ FONCTION DÉPRÉCIÉE - Remplacée par detectIntelligentCommands
    // Maintenue pour compatibilité avec l'ancien système
    return { shouldExecute: false };
}

async function executeCommandFromChat(senderId, commandName, args, ctx) {
    try {
        const COMMANDS = global.COMMANDS || new Map();
        
        if (!COMMANDS.has(commandName)) {
            const path = require('path');
            const fs = require('fs');
            const commandPath = path.join(__dirname, `${commandName}.js`);
            
            if (fs.existsSync(commandPath)) {
                delete require.cache[require.resolve(commandPath)];
                const commandModule = require(commandPath);
                
                if (typeof commandModule === 'function') {
                    const result = await commandModule(senderId, args, ctx);
                    return { success: true, result };
                }
            }
        } else {
            const commandFunction = COMMANDS.get(commandName);
            const result = await commandFunction(senderId, args, ctx);
            return { success: true, result };
        }
        
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        return commandResult;
    }
    
    try {
        // Essayer d'abord avec Gemini (avec rotation des clés)
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"
J'ai exécuté /${commandName} avec résultat: "${commandResult}"

Génère une réponse naturelle et amicale (max 400 chars) qui présente le résultat de manière conversationnelle.`;

        const response = await callGeminiWithRotation(contextPrompt);
        return response || commandResult;
        
    } catch (error) {
        // Fallback sur Mistral si besoin
        const { callMistralAPI } = ctx;
        try {
            const response = await callMistralAPI([
                { role: "system", content: "Réponds naturellement et amicalement." },
                { role: "user", content: `Utilisateur: "${originalMessage}"\nRésultat: "${commandResult}"\nPrésente ce résultat naturellement (max 200 chars)` }
            ], 200, 0.7);
            
            return response || commandResult;
        } catch (mistralError) {
            return commandResult;
        }
    }
}

// ✅ Exports pour autres commandes
module.exports.detectIntelligentCommands = detectIntelligentCommands;
module.exports.VALID_COMMANDS = VALID_COMMANDS;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.decideSearchNecessity = decideSearchNecessity;
module.exports.performIntelligentSearch = performIntelligentSearch;
module.exports.generateNaturalResponse = generateNaturalResponse;
module.exports.callGeminiWithRotation = callGeminiWithRotation;
module.exports.getNextGeminiKey = getNextGeminiKey;
module.exports.markKeyAsFailed = markKeyAsFailed;
