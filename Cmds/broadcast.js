// Cmds/broadcast.js
// Commande pour diffuser un message à tous les utilisateurs (admin seulement)

// État global du broadcast (partagé entre les deux commandes)
let broadcastState = {
    isRunning: false,
    currentMessage: null,
    sentTo: new Set(),
    totalUsers: 0,
    successCount: 0,
    errorCount: 0,
    startTime: null,
    cancelled: false
};

module.exports = async function(senderId, args, context) {
    const {
        isAdmin,
        userList,
        sendMessage,
        addToMemory,
        saveDataImmediate,
        log,
        sleep
    } = context;

    const senderIdStr = String(senderId);

    // ✅ Vérifier les permissions admin OBLIGATOIRES
    if (!isAdmin(senderId)) {
        const response = "🚫 Désolée ! La commande de diffusion est réservée aux administrateurs ! 💕\n\n✨ Tu peux utiliser /help pour voir ce que je peux faire pour toi !";
        addToMemory(senderId, 'user', '/broadcast');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // ✅ Vérifier si un broadcast est déjà en cours
    if (broadcastState.isRunning) {
        const elapsed = Math.round((Date.now() - broadcastState.startTime) / 1000);
        const progress = `${broadcastState.successCount + broadcastState.errorCount}/${broadcastState.totalUsers}`;
        
        const response = `🔄 **Diffusion déjà en cours !**\n\n📊 **Progression:** ${progress}\n✅ **Envoyés:** ${broadcastState.successCount}\n❌ **Erreurs:** ${broadcastState.errorCount}\n⏱️ **Temps écoulé:** ${elapsed}s\n\n💡 Utilise **/stop-broadcast** pour arrêter la diffusion en cours.`;
        
        addToMemory(senderId, 'user', '/broadcast');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // ✅ Vérifier le message à diffuser
    if (!args || args.trim().length === 0) {
        const response = "📢 **Commande Broadcast**\n\n🎯 **Usage:** `/broadcast [votre message]`\n\n📝 **Exemple:**\n`/broadcast 🎉 Nouvelle fonctionnalité disponible ! Tapez /help pour découvrir !`\n\n⚠️ **Important:** Le message sera envoyé à **TOUS** les utilisateurs (actuellement **" + userList.size + "** utilisateurs).\n\n💕 Réfléchis bien avant d'envoyer !";
        
        addToMemory(senderId, 'user', '/broadcast');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // ✅ Préparer le message final avec signature
    const userMessage = args.trim();
    const finalMessage = `📢 **Message de l'équipe NakamaBot:**\n\n${userMessage}\n\n✨ _Diffusion automatique - Tu peux continuer à me parler normalement !_ 💕`;

    // ✅ Vérifier la longueur du message
    if (finalMessage.length > 1800) {
        const response = `📝 **Message trop long !**\n\n📏 **Longueur actuelle:** ${finalMessage.length} caractères\n📏 **Maximum autorisé:** 1800 caractères\n\n💡 **Raccourcis ton message de ${finalMessage.length - 1800} caractères.**`;
        
        addToMemory(senderId, 'user', '/broadcast');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // ✅ Confirmer avant l'envoi
    const usersCount = userList.size;
    if (usersCount === 0) {
        const response = "👥 **Aucun utilisateur enregistré !**\n\n📊 La liste des utilisateurs est vide. Il n'y a personne à qui envoyer le message.\n\n💡 Les utilisateurs s'ajoutent automatiquement quand ils écrivent au bot.";
        
        addToMemory(senderId, 'user', '/broadcast');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // ✅ Enregistrer la commande en mémoire
    addToMemory(senderId, 'user', `/broadcast ${userMessage}`);

    // ✅ Démarrer le broadcast
    log.info(`📢 BROADCAST démarré par admin ${senderId} vers ${usersCount} utilisateurs`);
    
    // Initialiser l'état du broadcast
    broadcastState = {
        isRunning: true,
        currentMessage: finalMessage,
        sentTo: new Set(),
        totalUsers: usersCount,
        successCount: 0,
        errorCount: 0,
        startTime: Date.now(),
        cancelled: false
    };

    // ✅ Message de confirmation immédiat
    const confirmResponse = `🚀 **Diffusion lancée !**\n\n👥 **Destinataires:** ${usersCount} utilisateurs\n📝 **Message:** "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"\n\n⏳ **Diffusion en cours...** Je t'enverrai un rapport final !`;
    
    addToMemory(senderId, 'assistant', confirmResponse);

    // ✅ Processus de diffusion asynchrone (non-bloquant)
    processBroadcast(senderId, context).catch(error => {
        log.error(`❌ Erreur broadcast: ${error.message}`);
    });

    return confirmResponse;
};

// ✅ Fonction principale de diffusion (asynchrone)
async function processBroadcast(adminId, context) {
    const { userList, sendMessage, addToMemory, log, sleep } = context;
    
    const userArray = Array.from(userList);
    const startTime = Date.now();
    
    log.info(`📢 Début diffusion vers ${userArray.length} utilisateurs`);

    // ✅ Envoyer à chaque utilisateur avec gestion d'erreurs
    for (let i = 0; i < userArray.length && !broadcastState.cancelled; i++) {
        const userId = userArray[i];
        const userIdStr = String(userId);

        // ✅ Éviter d'envoyer à l'admin qui a lancé le broadcast
        if (userIdStr === String(adminId)) {
            log.debug(`⏭️ Admin ${adminId} ignoré dans le broadcast`);
            continue;
        }

        // ✅ Éviter les doublons
        if (broadcastState.sentTo.has(userIdStr)) {
            log.debug(`⏭️ Utilisateur ${userId} déjà traité`);
            continue;
        }

        try {
            // ✅ Envoyer le message
            const result = await sendMessage(userId, broadcastState.currentMessage);
            
            if (result.success) {
                broadcastState.successCount++;
                broadcastState.sentTo.add(userIdStr);
                log.debug(`✅ Broadcast envoyé à ${userId}`);
            } else {
                broadcastState.errorCount++;
                log.warning(`❌ Échec broadcast à ${userId}: ${result.error}`);
            }

        } catch (error) {
            broadcastState.errorCount++;
            log.error(`❌ Erreur broadcast à ${userId}: ${error.message}`);
        }

        // ✅ Pause entre envois pour éviter le spam (respecter les limites Facebook)
        if (i < userArray.length - 1 && !broadcastState.cancelled) {
            await sleep(150); // 150ms entre chaque envoi
        }

        // ✅ Log de progression tous les 10 utilisateurs
        if ((i + 1) % 10 === 0) {
            const progress = Math.round(((i + 1) / userArray.length) * 100);
            log.info(`📊 Broadcast: ${progress}% (${broadcastState.successCount}✅ ${broadcastState.errorCount}❌)`);
        }
    }

    // ✅ Calculs finaux
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    const totalProcessed = broadcastState.successCount + broadcastState.errorCount;
    
    // ✅ Rapport final
    let finalReport;
    
    if (broadcastState.cancelled) {
        finalReport = `🛑 **Diffusion ARRÊTÉE**\n\n📊 **Rapport:**\n✅ **Envoyés:** ${broadcastState.successCount}\n❌ **Erreurs:** ${broadcastState.errorCount}\n📈 **Traités:** ${totalProcessed}/${broadcastState.totalUsers}\n⏱️ **Durée:** ${duration}s\n\n💡 **Diffusion interrompue par stop-broadcast**`;
        
        log.info(`🛑 Broadcast ARRÊTÉ par admin: ${broadcastState.successCount}✅ ${broadcastState.errorCount}❌ en ${duration}s`);
    } else {
        const successRate = Math.round((broadcastState.successCount / totalProcessed) * 100);
        
        finalReport = `🎉 **Diffusion TERMINÉE !**\n\n📊 **Rapport final:**\n✅ **Envoyés:** ${broadcastState.successCount}\n❌ **Erreurs:** ${broadcastState.errorCount}\n📈 **Total:** ${totalProcessed}/${broadcastState.totalUsers}\n📊 **Taux de réussite:** ${successRate}%\n⏱️ **Durée:** ${duration}s\n\n💕 **Message diffusé avec succès !**`;
        
        log.info(`🎉 Broadcast TERMINÉ: ${broadcastState.successCount}✅ ${broadcastState.errorCount}❌ en ${duration}s (${successRate}%)`);
    }

    // ✅ Envoyer le rapport à l'admin
    try {
        const reportResult = await sendMessage(adminId, finalReport);
        if (reportResult.success) {
            addToMemory(adminId, 'assistant', finalReport);
        }
    } catch (error) {
        log.error(`❌ Erreur envoi rapport final: ${error.message}`);
    }

    // ✅ Réinitialiser l'état
    broadcastState = {
        isRunning: false,
        currentMessage: null,
        sentTo: new Set(),
        totalUsers: 0,
        successCount: 0,
        errorCount: 0,
        startTime: null,
        cancelled: false
    };
}

// ✅ Exporter l'état pour la commande stop-broadcast
module.exports.getBroadcastState = () => broadcastState;
module.exports.setBroadcastCancelled = () => {
    broadcastState.cancelled = true;
};
