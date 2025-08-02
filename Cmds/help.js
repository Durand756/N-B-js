/**
 * Commande /help - Affichage de l'aide avec boutons cliquables
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdHelp(senderId, args, ctx) {
    const { isAdmin } = ctx;
    
    try {
        const imageUrl = 'https://raw.githubusercontent.com/Durand756/N-B-js/refs/heads/main/Cmds/imgs/HELP-NAKAMA.png';
        await ctx.sendImageMessage(senderId, imageUrl);
    } catch (err) {
        ctx.log.error(`❌ Erreur image: ${err.message}`);
    }

    // Fonction pour envoyer un message avec boutons intégrés
    async function sendMessageWithButtons(recipientId, text, buttons) {
        if (!ctx.PAGE_ACCESS_TOKEN) {
            ctx.log.error("❌ PAGE_ACCESS_TOKEN manquant");
            return { success: false, error: "No token" };
        }

        const data = {
            recipient: { id: String(recipientId) },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: text,
                        buttons: buttons
                    }
                }
            }
        };

        try {
            const axios = require('axios');
            const response = await axios.post(
                "https://graph.facebook.com/v18.0/me/messages",
                data,
                {
                    params: { access_token: ctx.PAGE_ACCESS_TOKEN },
                    timeout: 15000
                }
            );

            return response.status === 200 ? { success: true } : { success: false, error: `API Error ${response.status}` };
        } catch (error) {
            ctx.log.error(`❌ Erreur envoi boutons: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    await ctx.sleep(300);

    // Message principal avec boutons BASE
    let mainText = `╔═══════════╗
║ 🤖 NAKAMABOT v4.0║
║ ----------HELP 🤖----------║
╚═══════════╝

🏠 COMMANDES BASE:
Clique sur les boutons ci-dessous ! ⬇️`;

    await sendMessageWithButtons(senderId, mainText, [
        {
            type: "postback",
            title: "🏠 /start",
            payload: "/start"
        },
        {
            type: "postback", 
            title: "💬 /chat",
            payload: "/chat Salut NakamaBot !"
        },
        {
            type: "postback",
            title: "🏆 /rank",
            payload: "/rank"
        }
    ]);

    await ctx.sleep(800);

    // Message MÉDIA avec boutons
    let mediaText = `🎵 COMMANDES MÉDIA:
Génération d'images et transformations ! 🎨`;

    await sendMessageWithButtons(senderId, mediaText, [
        {
            type: "postback",
            title: "🎵 /music",
            payload: "/music"
        },
        {
            type: "postback",
            title: "🎨 /image",
            payload: "/image chat mignon kawaii"
        },
        {
            type: "postback",
            title: "🎭 /anime",
            payload: "/anime"
        }
    ]);

    await ctx.sleep(800);

    // Message VISION & CLANS avec boutons
    let visionText = `👁️ VISION & ⚔️ CLANS:
Analyse d'images et système de guerre ! 👁️⚔️`;

    await sendMessageWithButtons(senderId, visionText, [
        {
            type: "postback",
            title: "👁️ /vision",
            payload: "/vision"
        },
        {
            type: "postback",
            title: "⚔️ /clan help",
            payload: "/clan help"
        },
        {
            type: "postback",
            title: "🔍 /search",
            payload: "/search"
        }
    ]);

    await ctx.sleep(800);

    // Boutons ADMIN (si admin)
    if (isAdmin(senderId)) {
        let adminText = `🔐 COMMANDES ADMIN:
Panel d'administration spécial ! 🔐`;

        await sendMessageWithButtons(senderId, adminText, [
            {
                type: "postback",
                title: "📊 /stats",
                payload: "/stats"
            },
            {
                type: "postback",
                title: "🔐 /admin", 
                payload: "/admin"
            },
            {
                type: "postback",
                title: "📢 /broadcast",
                payload: "/broadcast"
            }
        ]);

        await ctx.sleep(800);

        // Boutons admin avancés
        let adminAdvText = `🔐 ADMIN AVANCÉ:
Gestion système du bot ! ⚙️`;

        await sendMessageWithButtons(senderId, adminAdvText, [
            {
                type: "postback",
                title: "⏹️ /stop-broadcast",
                payload: "/stop-broadcast"
            },
            {
                type: "postback",
                title: "🔄 /restart",
                payload: "/restart"
            },
            {
                type: "postback",
                title: "❓ /help",
                payload: "/help"
            }
        ]);
    }

    await ctx.sleep(800);

    // Message final sans boutons
    let finalText = `════════════════════════
📝 INSTRUCTIONS:
🎨 Images: Décris ce que tu veux !
🎭 Anime: Envoie une image + clique /anime !
👁️ Vision: Envoie une image + clique /vision !
🏆 Expérience: Gagne des niveaux en discutant !

💡 Tu peux soit:
• Cliquer sur les boutons ⬆️
• Taper directement les commandes

╰─▸ Créé avec 💕 par Durand
💖 Toujours là pour t'aider ! ✨`;

    await ctx.sendMessage(senderId, finalText);

    return null; // Pas de retour car tout est envoyé directement
};
