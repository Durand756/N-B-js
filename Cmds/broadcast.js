// Cmds/broadcast.js - Version avec support images
// Commande de diffusion avec gestion d'images et délai de 2s

let broadcastState = {
    isRunning: false,
    sessionId: null,
    message: null,
    messageType: 'text', // 'text' ou 'image'
    imageUrl: null,
    caption: null,
    processed: new Set(),
    stats: { success: 0, failed: 0, total: 0 },
    adminId: null,
    cancelled: false
};

module.exports = async function(senderId, args, context) {
    const { isAdmin, userList, sendMessage, sendImage, addToMemory, log, sleep } = context;

    try {
        // Vérification admin
        if (!isAdmin(senderId)) {
            const response = "🚫 **Accès refusé !** Cette commande est réservée aux administrateurs.";
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Vérification si broadcast en cours
        if (broadcastState.isRunning) {
            const progress = `${broadcastState.stats.success + broadcastState.stats.failed}/${broadcastState.stats.total}`;
            const typeInfo = broadcastState.messageType === 'image' ? '🖼️ Diffusion IMAGE' : '📢 Diffusion TEXTE';
            const response = `🔄 **Diffusion en cours !**\n${typeInfo}\n📊 Progression: ${progress}\n✅ Réussis: ${broadcastState.stats.success}\n❌ Échecs: ${broadcastState.stats.failed}\n\n🛑 Utilise \`/stop-broadcast\` pour arrêter.`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Vérification du message
        if (!args || args.trim().length === 0) {
            const totalUsers = userList.size;
            const targetUsers = Math.max(0, totalUsers - 1);
            const response = `📢 **Commande Broadcast**\n\n🎯 **Usage texte:** \`/broadcast [message]\`\n🖼️ **Usage image:** \`/broadcast image [description]\`\n👥 **Destinataires:** ${targetUsers} utilisateurs\n\n⚠️ Le message sera envoyé à TOUS les utilisateurs !`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        const userMessage = args.trim();
        const totalUsers = userList.size;
        const targetUsers = Math.max(0, totalUsers - 1);

        // Vérification s'il s'agit d'une diffusion d'image
        if (userMessage.toLowerCase().startsWith('image ')) {
            const imagePrompt = userMessage.substring(6).trim();
            
            if (!imagePrompt) {
                const response = `🖼️ **Broadcast Image**\n\n🎯 Usage: \`/broadcast image [description]\`\n👥 Destinataires: ${targetUsers} utilisateurs\n\n💡 Exemple: \`/broadcast image beau coucher de soleil\``;
                addToMemory(senderId, 'user', '/broadcast image');
                addToMemory(senderId, 'assistant', response);
                return response;
            }

            // Générer l'image d'abord
            try {
                const { cmdImage } = require('./image');
                const imageResult = await cmdImage(senderId, imagePrompt, context);
                
                if (imageResult && imageResult.type === 'image') {
                    // Préparer la diffusion d'image
                    const caption = `📢 **Message de l'équipe NakamaBot :**\n\n${imageResult.caption || 'Image générée spécialement pour vous !'}\n\n✨ _Diffusion automatique_`;
                    
                    // Initialisation du broadcast image
                    broadcastState = {
                        isRunning: true,
                        sessionId: `${Date.now()}`,
                        message: caption,
                        messageType: 'image',
                        imageUrl: imageResult.url,
                        caption: caption,
                        processed: new Set(),
                        stats: { success: 0, failed: 0, total: targetUsers },
                        adminId: senderId,
                        cancelled: false
                    };

                    // Enregistrement en mémoire
                    addToMemory(senderId, 'user', `/broadcast image ${imagePrompt}`);

                    // Message de confirmation
                    const preview = imagePrompt.length > 40 ? imagePrompt.substring(0, 40) + "..." : imagePrompt;
                    const confirmResponse = `🚀 **Diffusion IMAGE lancée !**\n\n👥 **Destinataires :** ${targetUsers}\n🖼️ **Description :** "${preview}"\n\n⏳ Génération et diffusion en cours... Je t'enverrai un rapport à la fin !`;
                    addToMemory(senderId, 'assistant', confirmResponse);

                    // Lancement asynchrone
                    processBroadcast(Array.from(userList).filter(userId => String(userId) !== String(senderId)), context)
                        .catch(error => {
                            log.error(`Erreur broadcast image: ${error.message}`);
                            resetBroadcastState();
                        });

                    return confirmResponse;
                } else {
                    throw new Error('Échec de génération d\'image');
                }
            } catch (imageError) {
                log.error(`Erreur génération image broadcast: ${imageError.message}`);
                const errorResponse = `❌ **Erreur génération image !**\n\nImpossible de générer l'image: ${imageError.message}\n\nUtilise \`/broadcast [message]\` pour un message texte simple.`;
                addToMemory(senderId, 'assistant', errorResponse);
                return errorResponse;
            }
        }

        // Diffusion texte normale
        const finalMessage = `📢 **Message de l'équipe NakamaBot :**\n\n${userMessage}\n\n✨ _Diffusion automatique_`;

        // Vérification longueur
        if (finalMessage.length > 1800) {
            const response = `📝 **Message trop long !** (${finalMessage.length}/1800 caractères)`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Préparation des utilisateurs cibles
        const targetUsersArray = Array.from(userList).filter(userId => String(userId) !== String(senderId));
        
        if (targetUsersArray.length === 0) {
            const response = `👥 **Aucun destinataire !** Il n'y a aucun utilisateur à contacter.`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Initialisation du broadcast texte
        broadcastState = {
            isRunning: true,
            sessionId: `${Date.now()}`,
            message: finalMessage,
            messageType: 'text',
            imageUrl: null,
            caption: null,
            processed: new Set(),
            stats: { success: 0, failed: 0, total: targetUsersArray.length },
            adminId: senderId,
            cancelled: false
        };

        // Enregistrement en mémoire
        addToMemory(senderId, 'user', `/broadcast ${userMessage}`);

        // Message de confirmation
        const preview = userMessage.length > 60 ? userMessage.substring(0, 60) + "..." : userMessage;
        const confirmResponse = `🚀 **Diffusion TEXTE lancée !**\n\n👥 **Destinataires :** ${targetUsersArray.length}\n📝 **Message :** "${preview}"\n\n⏳ Diffusion en cours... Je t'enverrai un rapport à la fin !`;
        addToMemory(senderId, 'assistant', confirmResponse);

        // Lancement asynchrone
        processBroadcast(targetUsersArray, context).catch(error => {
            log.error(`Erreur broadcast: ${error.message}`);
            resetBroadcastState();
        });

        return confirmResponse;

    } catch (error) {
        log.error(`Erreur broadcast command: ${error.message}`);
        resetBroadcastState();
        const errorResponse = `❌ **Erreur !** ${error.message}`;
        addToMemory(senderId, 'assistant', errorResponse);
        return errorResponse;
    }
};

// Fonction principale de traitement
async function processBroadcast(targetUsers, context) {
    const { sendMessage, sendImage, addToMemory, log, sleep } = context;
    const { adminId, message, messageType, imageUrl, caption } = broadcastState;
    
    log.info(`📢 Début broadcast ${messageType} vers ${targetUsers.length} utilisateurs`);

    for (let i = 0; i < targetUsers.length && !broadcastState.cancelled; i++) {
        const userId = targetUsers[i];
        const userIdStr = String(userId);

        // Protection anti-doublons
        if (broadcastState.processed.has(userIdStr)) {
            continue;
        }

        broadcastState.processed.add(userIdStr);

        try {
            let result;
            
            if (messageType === 'image' && imageUrl) {
                // Envoi d'image avec caption
                result = await Promise.race([
                    sendImage(userId, imageUrl, caption || message),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout image')), 15000)
                    )
                ]);
            } else {
                // Envoi de texte simple
                result = await Promise.race([
                    sendMessage(userId, message),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout texte')), 10000)
                    )
                ]);
            }

            if (result && result.success) {
                broadcastState.stats.success++;
                log.debug(`✅ ${messageType.toUpperCase()} envoyé à ${userId}`);
            } else {
                broadcastState.stats.failed++;
                log.debug(`❌ Échec envoi ${messageType} à ${userId}: ${result?.error || 'Erreur inconnue'}`);
            }

        } catch (error) {
            broadcastState.stats.failed++;
            log.debug(`❌ Exception envoi ${messageType} à ${userId}: ${error.message}`);
        }

        // Délai de 2 secondes entre chaque envoi
        if (i < targetUsers.length - 1 && !broadcastState.cancelled) {
            await sleep(2000);
        }

        // Rapport de progression tous les 10 utilisateurs
        const processed = i + 1;
        if (processed % 10 === 0 || processed === targetUsers.length) {
            const percent = Math.round((processed / targetUsers.length) * 100);
            const typeEmoji = messageType === 'image' ? '🖼️' : '📢';
            log.info(`${typeEmoji} Broadcast ${percent}%: ${broadcastState.stats.success}✅ ${broadcastState.stats.failed}❌`);
            
            // Rapport intermédiaire tous les 20 utilisateurs
            if (processed % 20 === 0 && processed < targetUsers.length) {
                const typeText = messageType === 'image' ? 'IMAGE' : 'TEXTE';
                const report = `📊 **Progression ${typeText}: ${percent}%**\n✅ Réussis: ${broadcastState.stats.success}\n❌ Échecs: ${broadcastState.stats.failed}\n📈 Traités: ${processed}/${targetUsers.length}`;
                try {
                    await sendMessage(adminId, report);
                } catch (e) {
                    log.warning(`Impossible d'envoyer rapport intermédiaire: ${e.message}`);
                }
            }
        }
    }

    // Rapport final
    await generateFinalReport(context);
}

// Génération du rapport final
async function generateFinalReport(context) {
    const { sendMessage, addToMemory, log } = context;
    const { adminId, cancelled, stats, messageType } = broadcastState;

    const successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
    const typeText = messageType === 'image' ? 'IMAGE' : 'TEXTE';
    
    let finalReport;
    if (cancelled) {
        finalReport = `🛑 **Diffusion ${typeText} INTERROMPUE**\n\n📊 **Résultats partiels:**\n✅ Envoyés: ${stats.success}\n❌ Erreurs: ${stats.failed}\n📈 Traités: ${stats.success + stats.failed}/${stats.total}`;
    } else {
        finalReport = `🎉 **Diffusion ${typeText} TERMINÉE !**\n\n📊 **Rapport final:**\n✅ Envoyés: ${stats.success}\n❌ Erreurs: ${stats.failed}\n📈 Total: ${stats.total}\n📊 Taux de réussite: ${successRate}%\n\n💕 Message diffusé avec succès !`;
    }

    try {
        const result = await sendMessage(adminId, finalReport);
        if (result?.success) {
            addToMemory(adminId, 'assistant', finalReport);
        }
        log.info(`📋 Rapport final ${typeText} envoyé à l'admin ${adminId}`);
    } catch (error) {
        log.error(`Erreur envoi rapport final: ${error.message}`);
    }

    resetBroadcastState();
}

// Réinitialisation de l'état
function resetBroadcastState() {
    broadcastState = {
        isRunning: false,
        sessionId: null,
        message: null,
        messageType: 'text',
        imageUrl: null,
        caption: null,
        processed: new Set(),
        stats: { success: 0, failed: 0, total: 0 },
        adminId: null,
        cancelled: false
    };
}

// Exports pour stop-broadcast
module.exports.getBroadcastState = () => ({ ...broadcastState });
module.exports.setBroadcastCancelled = () => {
    if (broadcastState.isRunning) {
        broadcastState.cancelled = true;
        console.log(`🛑 Broadcast ${broadcastState.messageType} marqué pour annulation`);
    }
};
module.exports.resetBroadcastState = resetBroadcastState;
