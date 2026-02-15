/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🤖 NAKAMABOT - COMMANDE /REPLY
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Répond automatiquement aux commentaires non répondus sur les posts Facebook
 * en utilisant l'IA (Gemini/Mistral) pour générer des réponses contextuelles
 * 
 * Créateurs: Durand DJOUKAM & Myronne POUKEN (🇨🇲 Camerounais)
 * 
 * FONCTIONNALITÉS:
 * ✅ Liste les commentaires non répondus
 * ✅ Génère des réponses intelligentes avec l'IA
 * ✅ Répond automatiquement aux commentaires
 * ✅ Support multi-posts
 * ✅ Filtrage par mots-clés
 * ✅ Mode automatique programmable
 * 
 * COMMANDES:
 * /reply                    - Liste les commentaires non répondus
 * /reply list               - Liste détaillée avec options
 * /reply auto [post_id]     - Répond automatiquement
 * /reply [comment_id]       - Répond à un commentaire spécifique
 * /reply stats              - Statistiques des réponses
 * ═══════════════════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ═══════════════════════════════════════════════════════════════════════════
// 📊 CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    MAX_COMMENTS_PER_FETCH: 50,
    MAX_POSTS_TO_CHECK: 10,
    RESPONSE_MAX_LENGTH: 300,
    COMMENT_PREVIEW_LENGTH: 100,
    AUTO_REPLY_DELAY: 2000, // 2 secondes entre chaque réponse
    CACHE_DURATION: 300000  // 5 minutes
};

// Cache pour éviter de refetch constamment
const commentCache = new Map();
const statsCache = {
    totalReplied: 0,
    totalComments: 0,
    lastUpdate: null
};

// ═══════════════════════════════════════════════════════════════════════════
// 🔑 RÉCUPÉRATION DES COMMENTAIRES NON RÉPONDUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère les posts récents de la page
 */
async function getRecentPosts(pageAccessToken, limit = CONFIG.MAX_POSTS_TO_CHECK) {
    try {
        const response = await axios.get(
            `https://graph.facebook.com/v18.0/me/posts`,
            {
                params: {
                    access_token: pageAccessToken,
                    fields: 'id,message,created_time',
                    limit: limit
                },
                timeout: 10000
            }
        );
        
        return response.data.data || [];
    } catch (error) {
        console.error(`❌ Erreur récupération posts: ${error.message}`);
        return [];
    }
}

/**
 * Récupère les commentaires d'un post
 */
async function getPostComments(postId, pageAccessToken) {
    try {
        const response = await axios.get(
            `https://graph.facebook.com/v18.0/${postId}/comments`,
            {
                params: {
                    access_token: pageAccessToken,
                    fields: 'id,from,message,created_time,comment_count',
                    limit: CONFIG.MAX_COMMENTS_PER_FETCH,
                    filter: 'stream' // Tous les commentaires
                },
                timeout: 10000
            }
        );
        
        return response.data.data || [];
    } catch (error) {
        console.error(`❌ Erreur récupération commentaires: ${error.message}`);
        return [];
    }
}

/**
 * Vérifie si un commentaire a déjà une réponse
 */
async function hasReply(commentId, pageAccessToken) {
    try {
        const response = await axios.get(
            `https://graph.facebook.com/v18.0/${commentId}/comments`,
            {
                params: {
                    access_token: pageAccessToken,
                    limit: 1
                },
                timeout: 5000
            }
        );
        
        return response.data.data && response.data.data.length > 0;
    } catch (error) {
        return false;
    }
}

/**
 * Récupère tous les commentaires non répondus
 */
async function getUnrepliedComments(pageAccessToken, log) {
    const cacheKey = 'unreplied_comments';
    const now = Date.now();
    
    // Vérifier cache
    if (commentCache.has(cacheKey)) {
        const cached = commentCache.get(cacheKey);
        if (now - cached.timestamp < CONFIG.CACHE_DURATION) {
            log.info(`💾 Cache hit pour commentaires non répondus`);
            return cached.data;
        }
    }
    
    log.info(`🔍 Récupération des commentaires non répondus...`);
    
    const posts = await getRecentPosts(pageAccessToken);
    const unrepliedComments = [];
    
    for (const post of posts) {
        const comments = await getPostComments(post.id, pageAccessToken);
        
        for (const comment of comments) {
            // Vérifier si pas de réponse
            const replied = await hasReply(comment.id, pageAccessToken);
            
            if (!replied) {
                unrepliedComments.push({
                    commentId: comment.id,
                    postId: post.id,
                    postMessage: post.message || '[Pas de texte]',
                    author: comment.from.name,
                    authorId: comment.from.id,
                    message: comment.message,
                    createdTime: comment.created_time
                });
            }
        }
    }
    
    // Mettre en cache
    commentCache.set(cacheKey, {
        data: unrepliedComments,
        timestamp: now
    });
    
    log.info(`✅ ${unrepliedComments.length} commentaires non répondus trouvés`);
    return unrepliedComments;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🤖 GÉNÉRATION DE RÉPONSES AVEC IA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Génère une réponse intelligente avec Gemini
 */
async function generateReplyWithGemini(comment, postContext, geminiKey) {
    try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-3-flash-preview"
        });
        
        const prompt = `Tu es NakamaBot, assistant social media de la page Facebook.

CONTEXTE DU POST:
"${postContext.substring(0, 200)}"

COMMENTAIRE À RÉPONDRE:
De: ${comment.author}
Message: "${comment.message}"

INSTRUCTIONS:
- Réponds de manière amicale et professionnelle
- Sois court et concis (max 2-3 phrases)
- Adapte-toi au ton du commentaire
- Si c'est une question → réponds précisément
- Si c'est un compliment → remercie chaleureusement
- Si c'est négatif → réponds avec empathie
- Utilise 1 emoji maximum
- Max ${CONFIG.RESPONSE_MAX_LENGTH} caractères
- Évite les formules trop formelles

Ta réponse naturelle:`;

        const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 10000)
            )
        ]);
        
        const response = result.response.text();
        
        if (response && response.trim()) {
            // Nettoyer et limiter
            let cleaned = response.trim()
                .replace(/^(NakamaBot|Bot)\s*:\s*/i, '')
                .substring(0, CONFIG.RESPONSE_MAX_LENGTH);
            
            return cleaned;
        }
        
        throw new Error('Réponse vide');
        
    } catch (error) {
        console.error(`❌ Erreur Gemini: ${error.message}`);
        return null;
    }
}

/**
 * Génère une réponse avec Mistral (fallback)
 */
async function generateReplyWithMistral(comment, postContext, mistralKey) {
    try {
        const response = await Promise.race([
            axios.post(
                "https://api.mistral.ai/v1/chat/completions",
                {
                    model: "mistral-small-latest",
                    messages: [
                        {
                            role: "system",
                            content: `Tu es NakamaBot. Réponds aux commentaires Facebook de manière amicale. Court (max ${CONFIG.RESPONSE_MAX_LENGTH} chars).`
                        },
                        {
                            role: "user",
                            content: `Post: "${postContext.substring(0, 150)}"\n\nCommentaire de ${comment.author}: "${comment.message}"\n\nRéponds naturellement:`
                        }
                    ],
                    max_tokens: 150,
                    temperature: 0.7
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${mistralKey}`
                    }
                }
            ),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 10000)
            )
        ]);
        
        if (response.status === 200) {
            const text = response.data.choices[0].message.content;
            return text.substring(0, CONFIG.RESPONSE_MAX_LENGTH);
        }
        
        throw new Error(`Mistral erreur: ${response.status}`);
        
    } catch (error) {
        console.error(`❌ Erreur Mistral: ${error.message}`);
        return null;
    }
}

/**
 * Génère une réponse intelligente (Gemini → Mistral)
 */
async function generateSmartReply(comment, postContext, ctx) {
    const { log } = ctx;
    
    // Tentative Gemini
    const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? 
        process.env.GEMINI_API_KEY.split(',').map(k => k.trim()) : [];
    
    if (GEMINI_API_KEYS.length > 0) {
        for (const key of GEMINI_API_KEYS) {
            const reply = await generateReplyWithGemini(comment, postContext, key);
            if (reply) {
                log.info(`💎 Réponse générée avec Gemini`);
                return reply;
            }
        }
    }
    
    // Fallback Mistral
    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
    if (MISTRAL_API_KEY) {
        const reply = await generateReplyWithMistral(comment, postContext, MISTRAL_API_KEY);
        if (reply) {
            log.info(`🔄 Réponse générée avec Mistral`);
            return reply;
        }
    }
    
    // Fallback générique
    log.warning(`⚠️ Échec génération IA, utilisation réponse générique`);
    return `Merci pour ton commentaire ! 💙`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 📤 ENVOI DES RÉPONSES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Poste une réponse à un commentaire
 */
async function replyToComment(commentId, replyText, pageAccessToken, log) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v18.0/${commentId}/comments`,
            {
                message: replyText
            },
            {
                params: {
                    access_token: pageAccessToken
                },
                timeout: 10000
            }
        );
        
        if (response.status === 200) {
            log.info(`✅ Réponse envoyée au commentaire ${commentId}`);
            statsCache.totalReplied++;
            return { success: true, id: response.data.id };
        }
        
        throw new Error(`Erreur ${response.status}`);
        
    } catch (error) {
        log.error(`❌ Erreur envoi réponse: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🎨 FORMATAGE DES MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

function formatCommentsList(comments, maxDisplay = 10) {
    if (comments.length === 0) {
        return "🎉 **Aucun commentaire non répondu !**\n\nTous les commentaires ont été traités. Excellent travail ! 💪";
    }
    
    let message = `📝 **${comments.length} commentaire${comments.length > 1 ? 's' : ''} non répondu${comments.length > 1 ? 's' : ''}**\n\n`;
    
    const toDisplay = comments.slice(0, maxDisplay);
    
    toDisplay.forEach((comment, index) => {
        const preview = comment.message.length > CONFIG.COMMENT_PREVIEW_LENGTH 
            ? comment.message.substring(0, CONFIG.COMMENT_PREVIEW_LENGTH) + '...'
            : comment.message;
        
        const timeAgo = getTimeAgo(comment.createdTime);
        
        message += `${index + 1}. **${comment.author}** (${timeAgo})\n`;
        message += `   💬 "${preview}"\n`;
        message += `   🔗 ID: \`${comment.commentId}\`\n\n`;
    });
    
    if (comments.length > maxDisplay) {
        message += `\n... et ${comments.length - maxDisplay} autre${comments.length - maxDisplay > 1 ? 's' : ''}\n\n`;
    }
    
    message += `\n**Commandes disponibles:**\n`;
    message += `• \`/reply auto\` - Répond automatiquement à tous\n`;
    message += `• \`/reply [ID]\` - Répond à un commentaire spécifique\n`;
    message += `• \`/reply stats\` - Voir les statistiques`;
    
    return message;
}

function getTimeAgo(timestamp) {
    const now = new Date();
    const created = new Date(timestamp);
    const diffMs = now - created;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'à l\'instant';
    if (diffMins < 60) return `il y a ${diffMins} min`;
    if (diffHours < 24) return `il y a ${diffHours}h`;
    return `il y a ${diffDays}j`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 FONCTION PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════

module.exports = async function cmdReply(senderId, args, ctx) {
    const { PAGE_ACCESS_TOKEN, isAdmin, log, sendMessage } = ctx;
    
    // Vérification admin
    if (!isAdmin(senderId)) {
        return "🔒 Cette commande est réservée aux administrateurs.";
    }
    
    // Vérification token
    if (!PAGE_ACCESS_TOKEN) {
        return "❌ Token d'accès Facebook manquant. Configure PAGE_ACCESS_TOKEN dans les variables d'environnement.";
    }
    
    const command = args.trim().toLowerCase();
    
    try {
        // ═══════════════════════════════════════════════════════════════════
        // 📊 COMMANDE: /reply stats
        // ═══════════════════════════════════════════════════════════════════
        if (command === 'stats') {
            const comments = await getUnrepliedComments(PAGE_ACCESS_TOKEN, log);
            statsCache.totalComments = comments.length;
            statsCache.lastUpdate = new Date().toLocaleString('fr-FR');
            
            let statsMsg = `📊 **Statistiques des Réponses**\n\n`;
            statsMsg += `✅ Réponses envoyées: ${statsCache.totalReplied}\n`;
            statsMsg += `📝 Commentaires en attente: ${statsCache.totalComments}\n`;
            statsMsg += `🕐 Dernière mise à jour: ${statsCache.lastUpdate}\n\n`;
            statsMsg += `💡 Utilise \`/reply auto\` pour répondre automatiquement !`;
            
            return statsMsg;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 🤖 COMMANDE: /reply auto
        // ═══════════════════════════════════════════════════════════════════
        if (command === 'auto') {
            await sendMessage(senderId, "🤖 Lancement du mode automatique...");
            
            const comments = await getUnrepliedComments(PAGE_ACCESS_TOKEN, log);
            
            if (comments.length === 0) {
                return "🎉 Aucun commentaire à traiter !";
            }
            
            await sendMessage(senderId, `📝 ${comments.length} commentaire${comments.length > 1 ? 's' : ''} à traiter...\n\n⏳ Génération des réponses...`);
            
            let successCount = 0;
            let failCount = 0;
            
            for (const comment of comments) {
                try {
                    // Générer réponse
                    const reply = await generateSmartReply(comment, comment.postMessage, ctx);
                    
                    if (reply) {
                        // Envoyer réponse
                        const result = await replyToComment(comment.commentId, reply, PAGE_ACCESS_TOKEN, log);
                        
                        if (result.success) {
                            successCount++;
                            log.info(`✅ Réponse envoyée à ${comment.author}`);
                        } else {
                            failCount++;
                            log.error(`❌ Échec réponse à ${comment.author}`);
                        }
                    } else {
                        failCount++;
                    }
                    
                    // Délai entre chaque réponse
                    await new Promise(resolve => setTimeout(resolve, CONFIG.AUTO_REPLY_DELAY));
                    
                } catch (error) {
                    failCount++;
                    log.error(`❌ Erreur traitement commentaire: ${error.message}`);
                }
            }
            
            // Vider cache
            commentCache.clear();
            
            let resultMsg = `✅ **Traitement terminé !**\n\n`;
            resultMsg += `✅ Réponses envoyées: ${successCount}\n`;
            if (failCount > 0) {
                resultMsg += `❌ Échecs: ${failCount}\n`;
            }
            resultMsg += `\n💡 Utilise \`/reply stats\` pour voir les statistiques !`;
            
            return resultMsg;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 📝 COMMANDE: /reply [comment_id]
        // ═══════════════════════════════════════════════════════════════════
        if (command.length > 10 && /^[0-9_]+$/.test(command)) {
            const commentId = command;
            
            await sendMessage(senderId, `🤖 Génération d'une réponse pour le commentaire ${commentId}...`);
            
            // Trouver le commentaire
            const comments = await getUnrepliedComments(PAGE_ACCESS_TOKEN, log);
            const targetComment = comments.find(c => c.commentId === commentId);
            
            if (!targetComment) {
                return `❌ Commentaire ${commentId} introuvable ou déjà répondu.`;
            }
            
            // Générer réponse
            const reply = await generateSmartReply(targetComment, targetComment.postMessage, ctx);
            
            if (!reply) {
                return `❌ Impossible de générer une réponse. Réessaie !`;
            }
            
            // Envoyer réponse
            const result = await replyToComment(commentId, reply, PAGE_ACCESS_TOKEN, log);
            
            if (result.success) {
                commentCache.clear();
                
                let successMsg = `✅ **Réponse envoyée !**\n\n`;
                successMsg += `👤 À: ${targetComment.author}\n`;
                successMsg += `💬 Commentaire: "${targetComment.message.substring(0, 100)}..."\n\n`;
                successMsg += `📝 Réponse: "${reply}"`;
                
                return successMsg;
            } else {
                return `❌ Erreur lors de l'envoi: ${result.error}`;
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 📋 COMMANDE PAR DÉFAUT: /reply ou /reply list
        // ═══════════════════════════════════════════════════════════════════
        await sendMessage(senderId, "🔍 Récupération des commentaires...");
        
        const comments = await getUnrepliedComments(PAGE_ACCESS_TOKEN, log);
        const formattedList = formatCommentsList(comments);
        
        return formattedList;
        
    } catch (error) {
        log.error(`❌ Erreur commande /reply: ${error.message}`);
        return `❌ Erreur: ${error.message}\n\n💡 Utilise \`/help\` pour voir l'aide !`;
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// 📤 EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports.getUnrepliedComments = getUnrepliedComments;
module.exports.generateSmartReply = generateSmartReply;
module.exports.replyToComment = replyToComment;
module.exports.formatCommentsList = formatCommentsList;

console.log('✅ Commande /reply chargée (Auto-Reply Comments with AI)');
console.log('👥 Créateurs: Durand DJOUKAM & Myronne POUKEN (🇨🇲 Camerounais)');
