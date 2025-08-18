// Cmds/broadcast.js - Version optimisée
// Commande de diffusion avec gestion d'erreurs améliorée et délai de 2s

let broadcastState = {
    isRunning: false,
    sessionId: null,
    message: null,
    processed: new Set(),
    stats: { success: 0, failed: 0, total: 0 },
    adminId: null,
    cancelled: false
};

module.exports = async function(senderId, args, context) {
    const { isAdmin, userList, sendMessage, addToMemory, log, sleep } = context;

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
            const response = `🔄 **Diffusion en cours !**\n📊 Progression: ${progress}\n✅ Réussis: ${broadcastState.stats.success}\n❌ Échecs: ${broadcastState.stats.failed}\n\n🛑 Utilise \`/stop-broadcast\` pour arrêter.`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Vérification du message
        if (!args || args.trim().length === 0) {
            const totalUsers = userList.size;
            const targetUsers = Math.max(0, totalUsers - 1);
            const response = `📢 **Commande Broadcast**\n\n🎯 **Usage:** \`/broadcast [message]\`\n👥 **Destinataires:** ${targetUsers} utilisateurs\n\n⚠️ Le message sera envoyé à TOUS les utilisateurs !`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        const userMessage = args.trim();
        const finalMessage = `📢 **Message de l'équipe NakamaBot :**\n\n${userMessage}\n\n✨ _Diffusion automatique_`;

        // Vérification longueur
        if (finalMessage.length > 1800) {
            const response = `📝 **Message trop long !** (${finalMessage.length}/1800 caractères)`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Préparation des utilisateurs cibles
        const targetUsers = Array.from(userList).filter(userId => String(userId) !== String(senderId));
        
        if (targetUsers.length === 0) {
            const response = `👥 **Aucun destinataire !** Il n'y a aucun utilisateur à contacter.`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Initialisation du broadcast
        broadcastState = {
            isRunning: true,
            sessionId: `${Date.now()}`,
            message: finalMessage,
            processed: new Set(),
            stats: { success: 0, failed: 0, total: targetUsers.length },
            adminId: senderId,
            cancelled: false
        };

        // Enregistrement en mémoire
        addToMemory(senderId, 'user', `/broadcast ${userMessage}`);

        // Message de confirmation
        const preview = userMessage.length > 60 ? userMessage.substring(0, 60) + "..." : userMessage;
        const confirmResponse = `🚀 **Diffusion lancée !**\n\n👥 **Destinataires :** ${targetUsers.length}\n📝 **Message :** "${preview}"\n\n⏳ Diffusion en cours... Je t'enverrai un rapport à la fin !`;
        addToMemory(senderId, 'assistant', confirmResponse);

        // Lancement asynchrone
        processBroadcast(targetUsers, context).catch(error => {
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
    const { sendMessage, addToMemory, log, sleep } = context;
    const { adminId, message } = broadcastState;
    
    log.info(`📢 Début broadcast vers ${targetUsers.length} utilisateurs`);

    for (let i = 0; i < targetUsers.length && !broadcastState.cancelled; i++) {
        const userId = targetUsers[i];
        const userIdStr = String(userId);

        // Protection anti-doublons
        if (broadcastState.processed.has(userIdStr)) {
            continue;
        }

        broadcastState.processed.add(userIdStr);

        try {
            // Envoi avec timeout de 10 secondes
            const result = await Promise.race([
                sendMessage(userId, message),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 10000)
                )
            ]);

            if (result && result.success) {
                broadcastState.stats.success++;
                log.debug(`✅ Message envoyé à ${userId}`);
            } else {
                broadcastState.stats.failed++;
                log.debug(`❌ Échec envoi à ${userId}: ${result?.error || 'Erreur inconnue'}`);
            }

        } catch (error) {
            broadcastState.stats.failed++;
            log.debug(`❌ Exception envoi à ${userId}: ${error.message}`);
        }

        // Délai de 2 secondes entre chaque envoi
        if (i < targetUsers.length - 1 && !broadcastState.cancelled) {
            await sleep(2000);
        }

        // Rapport de progression tous les 10 utilisateurs
        const processed = i + 1;
        if (processed % 10 === 0 || processed === targetUsers.length) {
            const percent = Math.round((processed / targetUsers.length) * 100);
            log.info(`📊 Broadcast ${percent}%: ${broadcastState.stats.success}✅ ${broadcastState.stats.failed}❌`);
            
            // Rapport intermédiaire tous les 20 utilisateurs
            if (processed % 20 === 0 && processed < targetUsers.length) {
                const report = `📊 **Progression: ${percent}%**\n✅ Réussis: ${broadcastState.stats.success}\n❌ Échecs: ${broadcastState.stats.failed}\n📈 Traités: ${processed}/${targetUsers.length}`;
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
    const { adminId, cancelled, stats } = broadcastState;

    const successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
    
    let finalReport;
    if (cancelled) {
        finalReport = `🛑 **Diffusion INTERROMPUE**\n\n📊 **Résultats partiels:**\n✅ Envoyés: ${stats.success}\n❌ Erreurs: ${stats.failed}\n📈 Traités: ${stats.success + stats.failed}/${stats.total}`;
    } else {
        finalReport = `🎉 **Diffusion TERMINÉE !**\n\n📊 **Rapport final:**\n✅ Envoyés: ${stats.success}\n❌ Erreurs: ${stats.failed}\n📈 Total: ${stats.total}\n📊 Taux de réussite: ${successRate}%\n\n💕 Message diffusé avec succès !`;
    }

    try {
        const result = await sendMessage(adminId, finalReport);
        if (result?.success) {
            addToMemory(adminId, 'assistant', finalReport);
        }
        log.info(`📋 Rapport final envoyé à l'admin ${adminId}`);
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
        console.log(`🛑 Broadcast marqué pour annulation`);
    }
};
module.exports.resetBroadcastState = resetBroadcastState;
