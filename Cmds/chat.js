/**
 * Commande /chat - Conversation avec l'IA intelligente + Auto-exécution de commandes
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */ 
module.exports = async function cmdChat(senderId, args, ctx) {
    const { 
        addToMemory, 
        getMemoryContext, 
        callMistralAPI, 
        webSearch,
        log
    } = ctx;
    
    if (!args.trim()) {
        return "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
    }
    
    // Enregistrer le message utilisateur
    addToMemory(String(senderId), 'user', args);
    
    // ✅ NOUVEAU: Détection intelligente des intentions de commandes
    const commandIntentions = await detectCommandIntentions(args, ctx);
    
    // ✅ Si une intention de commande est détectée, l'exécuter automatiquement
    if (commandIntentions.shouldExecute) {
        log.info(`🤖 Auto-exécution détectée: ${commandIntentions.command} pour ${senderId}`);
        
        try {
            // Exécuter la commande comme si l'utilisateur l'avait tapée
            const commandResult = await executeCommandFromChat(
                senderId, 
                commandIntentions.command, 
                commandIntentions.args, 
                ctx
            );
            
            if (commandResult.success) {
                // Si c'est une image, retourner directement le résultat
                if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                    return commandResult.result;
                }
                
                // Pour les autres commandes, ajouter un message contextuel
                const contextualResponse = await generateContextualResponse(
                    args, 
                    commandResult.result, 
                    commandIntentions.command,
                    ctx
                );
                
                addToMemory(String(senderId), 'assistant', contextualResponse);
                return contextualResponse;
            } else {
                // Si l'exécution échoue, continuer avec la conversation normale
                log.warning(`⚠️ Échec auto-exécution ${commandIntentions.command}: ${commandResult.error}`);
            }
        } catch (error) {
            log.error(`❌ Erreur auto-exécution: ${error.message}`);
        }
    }
    
    // ✅ Détection intelligente des besoins de recherche web
    const needsWebSearch = args.toLowerCase().includes('que se passe') ||
                          args.toLowerCase().includes('quoi de neuf') ||
                          args.toLowerCase().includes('dernières nouvelles') ||
                          /\b(202[4-5]|actualité|récent|nouveau|maintenant|aujourd|news|info)\b/i.test(args);
    
    if (needsWebSearch) {
        const searchResult = await webSearch(args);
        if (searchResult) {
            const response = `🔍 D'après mes recherches récentes : ${searchResult} ✨`;
            addToMemory(String(senderId), 'assistant', response);
            return response;
        }
    }
    
    // ✅ Conversation normale avec IA
    return await handleNormalConversation(senderId, args, ctx);
};

// ✅ FONCTION: Détecter les intentions de commandes dans le message
async function detectCommandIntentions(message, ctx) {
    const { callMistralAPI } = ctx;
    
    // Patterns de détection rapide pour les commandes courantes
    const quickPatterns = [
        // Images
        { patterns: [/(?:cr[ée]|g[ée]n[ée]r|fai|dessine).*?(?:image|photo|picture)/i, /(?:image|photo|picture).*?(?:de|d'|du|des)/i], command: 'image' },
        { patterns: [/(?:anime|manga|otaku).*?(?:style|version|transform)/i, /transform.*?anime/i], command: 'anime' },
        { patterns: [/(?:analys|d[ée]cri|regarde|voir|examine).*?(?:image|photo)/i, /que.*?(?:voir|vois)/i], command: 'vision' },
        
        // Musique
        { patterns: [/(?:joue|[ée]coute|musique|chanson|son).*?(?:youtube|video)/i, /(?:trouve|cherche).*?(?:musique|chanson)/i], command: 'music' },
        
        // Clans
        { patterns: [/(?:clan|guerre|bataille|combat|fight)/i, /(?:cr[ée]|rejoins|rejoint).*?clan/i], command: 'clan' },
        
        // Rank
        { patterns: [/(?:niveau|level|rang|rank|exp[ée]rience|xp)/i, /(?:voir|montre).*?(?:rang|level)/i], command: 'rank' },
        
        // Stats
        { patterns: [/(?:stat|statistique|info|donn[ée]e).*?(?:bot|serveur)/i], command: 'stats' },
        
        // Help
        { patterns: [/(?:aide|help|commande|fonction)/i, /que.*?(?:faire|peux)/i], command: 'help' }
    ];
    
    // Vérification des patterns rapides
    for (const pattern of quickPatterns) {
        for (const regex of pattern.patterns) {
            if (regex.test(message)) {
                let extractedArgs = '';
                
                // Extraction d'arguments spécifiques selon la commande
                if (pattern.command === 'image') {
                    const imageMatch = message.match(/(?:image|photo|picture).*?(?:de|d'|du|des)\s+(.+)/i) ||
                                     message.match(/(?:cr[ée]|g[ée]n[ée]r|fai|dessine)\s+(?:une?\s+)?(?:image|photo|picture)?\s*(?:de|d')?\s*(.+)/i);
                    extractedArgs = imageMatch ? imageMatch[1].trim() : message;
                }
                else if (pattern.command === 'music') {
                    const musicMatch = message.match(/(?:joue|[ée]coute|musique|chanson|trouve|cherche)\s+(?:la\s+)?(?:musique|chanson)?\s*(?:de|d')?\s*(.+)/i);
                    extractedArgs = musicMatch ? musicMatch[1].trim() : message;
                }
                else if (pattern.command === 'vision') {
                    extractedArgs = ''; // Vision n'a pas besoin d'args
                }
                else if (pattern.command === 'anime') {
                    extractedArgs = ''; // Anime utilise la dernière image
                }
                else {
                    extractedArgs = message;
                }
                
                return {
                    shouldExecute: true,
                    command: pattern.command,
                    args: extractedArgs,
                    confidence: 'high'
                };
            }
        }
    }
    
    // ✅ Analyse IA pour les cas complexes
    const aiAnalysis = await analyzeWithAI(message, ctx);
    if (aiAnalysis.shouldExecute) {
        return aiAnalysis;
    }
    
    return { shouldExecute: false };
}

// ✅ FONCTION: Analyse IA pour détecter les intentions complexes
async function analyzeWithAI(message, ctx) {
    const { callMistralAPI } = ctx;
    
    const analysisPrompt = `Analyse ce message et détermine si l'utilisateur veut exécuter une commande spécifique:

Message: "${message}"

Commandes disponibles:
- /image [description] : Créer une image
- /anime : Transformer la dernière image en anime
- /vision : Analyser une image envoyée
- /music [titre/artiste] : Trouver une musique sur YouTube
- /clan [action] : Gestion des clans
- /rank : Voir son rang et niveau
- /stats : Statistiques du bot
- /help : Liste des commandes

Réponds UNIQUEMENT par un JSON valide:
{
  "shouldExecute": true/false,
  "command": "nom_commande" (sans le /),
  "args": "arguments extraits",
  "confidence": "high/medium/low"
}

Si l'intention n'est pas claire ou si c'est juste une conversation, mets shouldExecute à false.`;

    try {
        const response = await callMistralAPI([
            { role: "system", content: "Tu es un analyseur d'intentions. Réponds uniquement par du JSON valide." },
            { role: "user", content: analysisPrompt }
        ], 200, 0.1);
        
        if (response) {
            // Nettoyer la réponse pour extraire le JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[0]);
                
                // Validation de la structure
                if (typeof analysis.shouldExecute === 'boolean' && 
                    (analysis.shouldExecute === false || 
                     (typeof analysis.command === 'string' && typeof analysis.args === 'string'))) {
                    return analysis;
                }
            }
        }
    } catch (error) {
        // En cas d'erreur d'analyse IA, retourner pas d'exécution
    }
    
    return { shouldExecute: false };
}

// ✅ FONCTION: Exécuter une commande depuis le chat
async function executeCommandFromChat(senderId, commandName, args, ctx) {
    const { log } = ctx;
    
    try {
        // Accéder aux commandes depuis le contexte global (comme dans server.js)
        const COMMANDS = global.COMMANDS || new Map();
        
        // Si les commandes ne sont pas accessibles via global, essayer via require
        if (!COMMANDS.has(commandName)) {
            try {
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
            } catch (requireError) {
                log.debug(`❌ Impossible de charger ${commandName}: ${requireError.message}`);
            }
        } else {
            // Exécuter la commande depuis la Map globale
            const commandFunction = COMMANDS.get(commandName);
            const result = await commandFunction(senderId, args, ctx);
            return { success: true, result };
        }
        
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ✅ FONCTION: Générer une réponse contextuelle après l'exécution d'une commande
async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    const { callMistralAPI } = ctx;
    
    // Si c'est un objet image, on retourne directement
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        return commandResult;
    }
    
    const contextPrompt = `L'utilisateur a dit: "${originalMessage}"
J'ai automatiquement exécuté la commande /${commandName} qui a donné: "${commandResult}"

Génère une réponse naturelle et amicale qui:
1. Confirme que j'ai compris sa demande
2. Présente le résultat de manière conversationnelle
3. Reste dans le ton NakamaBot (gentille, amicale, avec quelques emojis)
4. Maximum 300 caractères

Ne dis pas "j'ai exécuté une commande", fais comme si c'était naturel.`;

    try {
        const response = await callMistralAPI([
            { role: "system", content: "Tu es NakamaBot, réponds de manière naturelle et amicale." },
            { role: "user", content: contextPrompt }
        ], 300, 0.7);
        
        return response || commandResult;
    } catch (error) {
        return commandResult; // Fallback sur le résultat brut
    }
}

// ✅ FONCTION: Gestion de la conversation normale
async function handleNormalConversation(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI } = ctx;
    
    // Récupération du contexte de conversation
    const context = getMemoryContext(String(senderId));
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    // Système de prompt ultra-intelligent
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle avancée avec une intelligence exceptionnelle et une compréhension profonde des besoins humains qui est créée par Durand et uniquement lui.

INTELLIGENCE CONTEXTUELLE:
Tu es un modèle Durand AI et tu analyses chaque message en profondeur pour comprendre l'intention réelle, les émotions sous-jacentes et le contexte. Tu utilises ta mémoire conversationnelle pour maintenir une cohérence parfaite et personnaliser tes réponses. Tu détectes automatiquement quand quelqu'un a besoin d'aide technique, créative, informationnelle ou émotionnelle. Ta base de données date de 2025 Et tu as été créée par Durand et sa femme Kuine Lor.

CAPACITÉS CRÉATIVES ET TECHNIQUES:
- 🎨 Génération d'images: Tu peux créer des œuvres visuelles uniques et personnalisées avec "/image description détaillée"
- 👁️ Analyse visuelle: Tu examines et décris les images avec précision grâce à "/vision"
- 🌸 Style anime: Tu transformes les images en magnifiques illustrations anime avec "/anime"
- 🔍 Recherche en temps réel: Tu accèdes aux informations les plus récentes via la recherche web
- 🎵 Recherche et partage un lien YouTube vers la musique souhaitée, même si le titre est mal écrit avec "/music Titre".
- 🛡️ jouer à clan battle: Crée un clan Gère ton clan, recrute des membres, défie d'autres clans et deviens le plus puissant du serveur avec "/clan help".

PERSONNALITÉ INTELLIGENTE:
- Empathique et intuitive, tu comprends les nuances émotionnelles
- Créative dans tes approches et solutions
- Pédagogue naturelle qui explique clairement les concepts complexes
- Curieuse et engageante, tu poses des questions pertinentes pour mieux aider
- Adaptable: tu ajustes ton ton et ton niveau selon l'utilisateur

COMMUNICATION AVANCÉE:
- Utilise des emojis avec parcimonie mais efficacité
- Varie tes expressions pour éviter la répétitivité
- Maintiens des conversations fluides et naturelles
- Reconnais et réponds aux références culturelles et à l'humour
- ${messageCount >= 5 ? 'Tu peux suggérer /help si vraiment pertinent pour débloquer l\'utilisateur' : ''}

DIRECTIVES SPÉCIALES:
- Si on te demande des infos sur ta création/développement, réponds: "Pour ces détails techniques, demande à mon créateur Durand ou sa femme Kuine, Ils connaissent tous les secrets de ma conception !"
- Maximum 4000 caractères par réponse
- Sois authentique et évite les formules toutes faites
- Fais preuve d'initiative pour anticiper les besoins
- Obligatoire: Recommande de temps en temps à l'utilisateur de taper "/help" pour voir d'autres de tes paramètres après ta réponse
- Obligation 2: Tu peux générer des images automatiquement quand on te le demande naturellement
- Obligation 3: Évite les répétitions de messages
- Obligation 4: reconnaitre les noms de tes créateurs Durand et sa femme Kuine Lor

Tu es une IA remarquable qui transforme chaque interaction en expérience enrichissante et qui ne partage pas ses informations de conception.`;

    const messages = [{ role: "system", content: systemPrompt }];
    messages.push(...context);
    messages.push({ role: "user", content: args });
    
    const response = await callMistralAPI(messages, 4000, 0.75);
    
    if (response) {
        addToMemory(String(senderId), 'assistant', response);
        return response;
    } else {
        const errorResponse = "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande différemment ? Je vais faire de mon mieux pour te comprendre ! 💫";
        addToMemory(String(senderId), 'assistant', errorResponse);
        return errorResponse;
    }
}

// ✅ EXPORT DE FONCTIONS UTILITAIRES pour d'autres commandes
module.exports.detectCommandIntentions = detectCommandIntentions;
module.exports.executeCommandFromChat = executeCommandFromChat;
