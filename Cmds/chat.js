/**
 * NakamaBot - Commande /chat avec recherche intelligente intégrée et rotation des clés Gemini
 * + Support Markdown vers Unicode stylisé pour Facebook Messenger
 * + Système de troncature synchronisé avec le serveur principal
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

// 🎨 FONCTIONS DE PARSING MARKDOWN → UNICODE
// ========================================

/**
 * Mappings des caractères Unicode pour le styling
 */
const UNICODE_MAPPINGS = {
    // Gras (Mathematical Bold)
    bold: {
    'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺',
    'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
    'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠',
    'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧', 'U': '𝗨', 'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
    '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    }
};

/**
 * Convertit une chaîne en gras Unicode
 * @param {string} str - Texte à convertir
 * @returns {string} - Texte en gras Unicode
 */
function toBold(str) {
    return str.split('').map(char => UNICODE_MAPPINGS.bold[char] || char).join('');
}

/**
 * Convertit une chaîne en italique Unicode (SUPPRIMÉ)
 * @param {string} str - Texte à convertir
 * @returns {string} - Texte original sans modification
 */
function toItalic(str) {
    // Italique désactivé - retourne le texte original
    return str;
}

/**
 * Convertit une chaîne en souligné Unicode
 * @param {string} str - Texte à convertir
 * @returns {string} - Texte souligné Unicode
 */
function toUnderline(str) {
    return str.split('').map(char => char + '\u0332').join('');
}

/**
 * Convertit une chaîne en barré Unicode
 * @param {string} str - Texte à convertir
 * @returns {string} - Texte barré Unicode
 */
function toStrikethrough(str) {
    return str.split('').map(char => char + '\u0336').join('');
}

/**
 * Parse le Markdown et le convertit en Unicode stylisé
 * @param {string} text - Texte avec Markdown
 * @returns {string} - Texte stylisé en Unicode
 */
function parseMarkdown(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    let parsed = text;

    // 1. Traitement des titres (### titre) - FIX: Regex corrigée
    parsed = parsed.replace(/^###\s+(.+)$/gm, (match, title) => {
        return `🔹 ${toBold(title.trim())}`;
    });

    // 2. Traitement du gras (**texte**)
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
        return toBold(content);
    });

    // 3. Traitement de l'italique (*texte*) - DÉSACTIVÉ
    // L'italique est désactivé, les *texte* restent inchangés

    // 4. Traitement du souligné (__texte__)
    parsed = parsed.replace(/__([^_]+)__/g, (match, content) => {
        return toUnderline(content);
    });

    // 5. Traitement du barré (~~texte~~)
    parsed = parsed.replace(/~~([^~]+)~~/g, (match, content) => {
        return toStrikethrough(content);
    });

    // 6. Traitement des listes (- item ou * item)
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (match, content) => {
        return `• ${content.trim()}`;
    });

    return parsed;
}

// ========================================
// FONCTIONS EXISTANTES (inchangées)
// ========================================

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

// 🛡️ FONCTION PRINCIPALE AVEC PROTECTION ANTI-DOUBLONS ET TRONCATURE SYNCHRONISÉE
module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, webSearch, log, 
            truncatedMessages, splitMessageIntoChunks, isContinuationRequest, saveDataImmediate } = ctx;
    
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
            const styledWelcome = parseMarkdown(welcomeMsg);
            // ✅ UN SEUL addToMemory ici
            addToMemory(String(senderId), 'assistant', styledWelcome);
            return styledWelcome;
        }
        
        // 🆕 GESTION SYNCHRONISÉE DES DEMANDES DE CONTINUATION
        const senderIdStr = String(senderId);
        if (isContinuationRequest(args)) {
            const truncatedData = truncatedMessages.get(senderIdStr);
            if (truncatedData) {
                const { fullMessage, lastSentPart } = truncatedData;
                const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
                const remainingMessage = fullMessage.substring(lastSentIndex);
                
                if (remainingMessage.trim()) {
                    const chunks = splitMessageIntoChunks(remainingMessage, 2000);
                    const nextChunk = parseMarkdown(chunks[0]);
                    
                    // Mettre à jour le cache avec la nouvelle partie envoyée
                    if (chunks.length > 1) {
                        truncatedMessages.set(senderIdStr, {
                            fullMessage: fullMessage,
                            lastSentPart: lastSentPart + chunks[0],
                            timestamp: new Date().toISOString()
                        });
                        
                        // Ajouter un indicateur de continuation
                        const continuationMsg = nextChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', continuationMsg);
                        saveDataImmediate();
                        return continuationMsg;
                    } else {
                        // Message terminé
                        truncatedMessages.delete(senderIdStr);
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', nextChunk);
                        saveDataImmediate();
                        return nextChunk;
                    }
                } else {
                    // Plus rien à envoyer
                    truncatedMessages.delete(senderIdStr);
                    const endMsg = "✅ C'est tout ! Y a-t-il autre chose que je puisse faire pour toi ? 💫";
                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', endMsg);
                    saveDataImmediate();
                    return endMsg;
                }
            } else {
                // Pas de message tronqué en cours
                const noTruncMsg = "🤔 Il n'y a pas de message en cours à continuer. Pose-moi une nouvelle question ! 💡";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noTruncMsg);
                return noTruncMsg;
            }
        }
        
        // ✅ Détection des demandes de contact admin
        const contactIntention = detectContactAdminIntention(args);
        if (contactIntention.shouldContact) {
            log.info(`📞 Intention contact admin détectée pour ${senderId}: ${contactIntention.reason}`);
            const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            const styledContact = parseMarkdown(contactSuggestion);
            
            // ✅ UN SEUL APPEL groupé
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', styledContact);
            return styledContact;
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
                    
                    // Réponse contextuelle naturelle avec styling
                    const contextualResponse = await generateContextualResponse(args, commandResult.result, intelligentCommand.command, ctx);
                    const styledResponse = parseMarkdown(contextualResponse);
                    
                    // ✅ UN SEUL APPEL groupé
                    addToMemory(String(senderId), 'user', args);
                    addToMemory(String(senderId), 'assistant', styledResponse);
                    return styledResponse;
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
                // 🔧 FIX: Récupérer le contexte AVANT la recherche pour le maintenir
                const conversationContext = getMemoryContext(String(senderId)).slice(-8);
                
                const searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
                
                if (searchResults && searchResults.length > 0) {
                    // 🔧 FIX: Passer le contexte à la génération de réponse naturelle
                    const naturalResponse = await generateNaturalResponseWithContext(args, searchResults, conversationContext, ctx);
                    
                    if (naturalResponse) {
                        // ✅ GESTION SYNCHRONISÉE DES MESSAGES LONGS
                        const styledNatural = parseMarkdown(naturalResponse);
                        
                        // Vérifier si le message est trop long et gérer la troncature
                        if (styledNatural.length > 2000) {
                            log.info(`📏 Message de recherche long détecté (${styledNatural.length} chars) - Gestion troncature`);
                            
                            const chunks = splitMessageIntoChunks(styledNatural, 2000);
                            const firstChunk = chunks[0];
                            
                            if (chunks.length > 1) {
                                // Sauvegarder l'état de troncature
                                truncatedMessages.set(senderIdStr, {
                                    fullMessage: styledNatural,
                                    lastSentPart: firstChunk,
                                    timestamp: new Date().toISOString()
                                });
                                
                                const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                                addToMemory(String(senderId), 'user', args);
                                addToMemory(String(senderId), 'assistant', truncatedResponse);
                                saveDataImmediate();
                                log.info(`🔍✅ Recherche terminée avec troncature pour ${senderId}`);
                                return truncatedResponse;
                            }
                        }
                        
                        addToMemory(String(senderId), 'user', args);
                        addToMemory(String(senderId), 'assistant', styledNatural);
                        return styledNatural;
                    }
                }
                
                // Fallback si recherche échoue
                log.warning(`⚠️ Recherche échouée pour ${senderId}: Pas de résultats pertinents`);
                const fallbackMsg = "🤔 Je n'ai pas trouvé d'informations récentes sur cela. Peux-tu reformuler ta question ? 💫";
                addToMemory(String(senderId), 'assistant', fallbackMsg);
                return fallbackMsg;
                
            } catch (searchError) {
                log.error(`❌ Erreur recherche pour ${senderId}: ${searchError.message}`);
                // Continue avec réponse IA sans recherche
            }
        }
        
        // ✅ CONVERSATION NORMALE: Système prompt amical et contextuel
        const systemPrompt = "Tu es NakamaBot, une assistante IA super gentille, amicale et bienveillante en 2025. Tu es comme une meilleure amie : douce, drôle, attentive, et toujours positive. Réponds en français avec une personnalité chaleureuse et enthousiaste. Utilise des emojis mignons pour rendre tes réponses vivantes (max 3 par phrase). Sois concise mais complète (max 400 caractères). Si la question est complexe, structure avec des listes ou titres courts. Tu peux utiliser du Markdown simple (**gras**, ### titres) mais pas d'italique. Si tu ne sais pas, dis-le gentiment et propose une alternative. Termine souvent par une question pour continuer la conversation.";
        
        // Récupérer le contexte de conversation (derniers 8 messages)
        const context = getMemoryContext(String(senderId)).slice(-8);
        
        // Essayer d'abord avec Gemini (avec rotation des clés)
        const messages = [{ role: "system", content: systemPrompt }];
        messages.push(...context);
        messages.push({ role: "user", content: args });
        
        const geminiResponse = await callGeminiWithRotation(messages);
        
        if (geminiResponse) {
            const styledResponse = parseMarkdown(geminiResponse);
            
            // ✅ GESTION SYNCHRONISÉE DE LA TRONCATURE
            if (styledResponse.length > 2000) {
                log.info(`📏 Réponse Gemini longue détectée (${styledResponse.length} chars) - Gestion troncature`);
                
                const chunks = splitMessageIntoChunks(styledResponse, 2000);
                const firstChunk = chunks[0];
                
                if (chunks.length > 1) {
                    // Sauvegarder l'état de troncature
                    truncatedMessages.set(senderIdStr, {
                        fullMessage: styledResponse,
                        lastSentPart: firstChunk,
                        timestamp: new Date().toISOString()
                    });
                    
                    const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                    // ✅ UN SEUL APPEL groupé à addToMemory
                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', truncatedResponse);
                    saveDataImmediate();
                    log.info(`💎 Gemini réponse avec troncature pour ${senderId}: ${args.substring(0, 30)}...`);
                    return truncatedResponse;
                }
            }
            
            // ✅ UN SEUL APPEL groupé à addToMemory pour message normal
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', styledResponse);
            log.info(`💎 Gemini réponse pour ${senderId}: ${args.substring(0, 30)}...`);
            return styledResponse;
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
                const styledResponse = parseMarkdown(mistralResponse);
                
                // ✅ GESTION SYNCHRONISÉE DE LA TRON CATURE POUR MISTRAL AUSSI
                if (styledResponse.length > 2000) {
                    log.info(`📏 Réponse Mistral longue détectée (${styledResponse.length} chars) - Gestion troncature`);
                    
                    const chunks = splitMessageIntoChunks(styledResponse, 2000);
                    const firstChunk = chunks[0];
                    
                    if (chunks.length > 1) {
                        // Sauvegarder l'état de troncature
                        truncatedMessages.set(senderIdStr, {
                            fullMessage: styledResponse,
                            lastSentPart: firstChunk,
                            timestamp: new Date().toISOString()
                        });
                        
                        const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                        // ✅ UN SEUL APPEL groupé à addToMemory
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', truncatedResponse);
                        saveDataImmediate();
                        log.info(`🔄 Mistral fallback avec troncature pour ${senderId}: ${args.substring(0, 30)}...`);
                        return truncatedResponse;
                    }
                }
                
                // ✅ UN SEUL APPEL groupé à addToMemory pour message normal
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', styledResponse);
                log.info(`🔄 Mistral fallback pour ${senderId}: ${args.substring(0, 30)}...`);
                return styledResponse;
            }
            
            throw new Error('Mistral aussi en échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale conversation ${senderId}: Gemini(${geminiError.message}) + Mistral(${mistralError.message})`);
            
            const errorResponse = "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande différemment ? 💫";
            const styledError = parseMarkdown(errorResponse);
            // ✅ UN SEUL addToMemory pour les erreurs
            addToMemory(senderIdStr, 'assistant', styledError);
            return styledError;
        }
    } finally {
        // 🛡️ PROTECTION 5: Libérer la demande active UNIQUEMENT si c'est la même
        if (activeRequests.get(senderId) === requestKey) {
            activeRequests.delete(senderId);
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
            /^(météo|quel\s+temps|quel\s+temps|température|prévisions)/,
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

Génère une réponse naturelle et amicale (max 400 chars) qui présente le résultat de manière conversationnelle. Tu peux utiliser du Markdown simple (**gras**, ### titres) mais pas d'italique.`;

        const response = await callGeminiWithRotation(contextPrompt);
        return response || commandResult;
        
    } catch (error) {
        // Fallback sur Mistral si besoin
        const { callMistralAPI } = ctx;
        try {
            const response = await callMistralAPI([
                { role: "system", content: "Réponds naturellement et amicalement. Tu peux utiliser du Markdown simple (**gras**, ### titres) mais pas d'italique." },
                { role: "user", content: `Utilisateur: "${originalMessage}"\nRésultat: "${commandResult}"\nPrésente ce résultat naturellement (max 200 chars)` }
            ], 200, 0.7);
            
            return response || commandResult;
        } catch (mistralError) {
            return commandResult;
        }
    }
}

async function decideSearchNecessity(message, senderId, ctx) {
    const { log } = ctx;
    
    try {
        const decisionPrompt = `Tu es un système intelligent qui décide si une recherche externe est nécessaire pour répondre à un message en 2025.

MESSAGE: "${message}"

RÈGLES STRICTES:
- OUI si: actualités récentes, faits vérifiables, prix, météo, événements courants, recherches web spécifiques, questions factuelles non générales.
- NON si: opinions, conversations personnelles, blagues, salutations, questions philosophiques, maths pures, créativité, commandes bot, messages émotionnels.
- Seulement si l'info n'est pas dans mes connaissances intégrées (jusqu'en 2023).

Réponds UNIQUEMENT avec JSON:
{
  "needsSearch": true/false,
  "reason": "explication_courte",
  "searchQuery": "requête_optimisée_si_oui_ou_null"
}`;

        const response = await callGeminiWithRotation(decisionPrompt);
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const aiDecision = JSON.parse(jsonMatch[0]);
            
            if (aiDecision.needsSearch && aiDecision.searchQuery) {
                log.info(`🔍 Recherche décidée: ${aiDecision.reason} - Query: ${aiDecision.searchQuery}`);
                return {
                    needsExternalSearch: true,
                    reason: aiDecision.reason,
                    searchQuery: aiDecision.searchQuery
                };
            }
        }
        
        return { needsExternalSearch: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
        return { needsExternalSearch: false };
    }
}

async function performIntelligentSearch(query, ctx) {
    const { log, webSearch } = ctx;
    
    try {
        // Priorité à Google Custom Search si configuré
        if (GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID) {
            const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=5`;
            
            const response = await axios.get(searchUrl);
            if (response.data && response.data.items) {
                return response.data.items.map(item => ({
                    title: item.title,
                    snippet: item.snippet,
                    link: item.link
                }));
            }
        }
        
        // Fallback à SerpAPI si configuré
        if (SERPAPI_KEY) {
            const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=5`;
            
            const response = await axios.get(serpUrl);
            if (response.data && response.data.organic_results) {
                return response.data.organic_results.map(result => ({
                    title: result.title,
                    snippet: result.snippet,
                    link: result.link
                }));
            }
        }
        
        // Ultime fallback: webSearch du contexte (si disponible)
        if (webSearch) {
            return await webSearch(query);
        }
        
        throw new Error('Aucun moteur de recherche configuré');
        
    } catch (error) {
        log.error(`❌ Erreur recherche externe: ${error.message}`);
        return [];
    }
}

async function generateNaturalResponse(originalMessage, searchResults, ctx) {
    try {
        const resultsSummary = searchResults.map(r => `Titre: ${r.title}\nSnippet: ${r.snippet}\nLien: ${r.link}`).join('\n\n');
        
        const prompt = `Utilisateur: "${originalMessage}"
Résultats recherche: ${resultsSummary}

Génère une réponse naturelle, amicale et informative basée sur ces résultats. Sois concise, positive, utilise des emojis mignons. Structure avec Markdown si besoin (titres, listes). Max 400 chars. Termine par une question pour engager.`;

        return await callGeminiWithRotation(prompt);
        
    } catch (error) {
        const { callMistralAPI } = ctx;
        try {
            const messages = [
                { role: "system", content: "Réponds naturellement avec les infos fournies. Amicale et concise." },
                { role: "user", content: `Question: "${originalMessage}"\nInfos: ${resultsSummary}\nRéponds bien (max 300 chars)` }
            ];
            
            return await callMistralAPI(messages, 300, 0.7);
        } catch {
            return "Voici ce que j'ai trouvé : " + searchResults.map(r => r.title).join(', ');
        }
    }
}

async function generateNaturalResponseWithContext(originalMessage, searchResults, context, ctx) {
    try {
        const resultsSummary = searchResults.map(r => `Titre: ${r.title}\nSnippet: ${r.snippet}\nLien: ${r.link}`).join('\n\n');
        const contextSummary = context.map(msg => `${msg.role}: ${msg.content}`).join('\n');
        
        const prompt = `Contexte conversation: ${contextSummary}
Utilisateur: "${originalMessage}"
Résultats: ${resultsSummary}

Réponds naturellement en tenant compte du contexte. Amicale, positive, emojis mignons. Markdown simple si besoin. Max 400 chars. Termine par question.`;

        return await callGeminiWithRotation(prompt);
        
    } catch (error) {
        return await generateNaturalResponse(originalMessage, searchResults, ctx);
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
module.exports.generateNaturalResponseWithContext = generateNaturalResponseWithContext;
module.exports.callGeminiWithRotation = callGeminiWithRotation;
module.exports.getNextGeminiKey = getNextGeminiKey;
module.exports.markKeyAsFailed = markKeyAsFailed;

// 🆕 EXPORTS DES NOUVELLES FONCTIONS MARKDOWN
module.exports.parseMarkdown = parseMarkdown;
module.exports.toBold = toBold;
module.exports.toItalic = toItalic;
module.exports.toUnderline = toUnderline;
module.exports.toStrikethrough = toStrikethrough;
