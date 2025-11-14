// Générateur de graphiques de statistiques
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');
const { loadImage } = require('canvas');

class StatsGenerator {
    constructor() {
        // Configuration du canvas (taille de l'image)
        this.width = 1000;
        this.height = 400;
        
        // Enregistrer une police de base pour éviter les erreurs Fontconfig
        const { registerFont } = require('canvas');
        // Note: On utilise la police système, pas besoin d'enregistrer si on utilise 'sans-serif'
        
        // Plugin personnalisé pour dessiner l'icône, le total ET les labels (contournement des problèmes de police)
        const customLegendPlugin = {
            id: 'customLegend',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                const chartArea = chart.chartArea;
                
                // Dessiner la photo de profil et le pseudo centrés (pour stats utilisateur)
                if (chart.options.plugins.userProfile) {
                    const profile = chart.options.plugins.userProfile;
                    const avatar = profile.avatar;
                    const username = profile.username;
                    
                    // Taille et position de l'avatar
                    const avatarSize = 40;
                    const centerX = chart.width / 2;
                    const avatarY = 10;
                    
                    // Dessiner l'avatar arrondi
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(centerX, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(avatar, centerX - avatarSize / 2, avatarY, avatarSize, avatarSize);
                    ctx.restore();
                    
                    // Dessiner le pseudo à côté
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 16px "DejaVu Sans", sans-serif';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(username, centerX + avatarSize / 2 + 10, avatarY + avatarSize / 2);
                }
                
                // Dessiner l'icône (sans texte) - pour stats serveur
                if (chart.options.plugins.customIcon) {
                    const icon = chart.options.plugins.customIcon;
                    
                    // Calculer les dimensions en préservant le ratio original
                    const originalWidth = icon.width;
                    const originalHeight = icon.height;
                    const targetHeight = 35; // Hauteur souhaitée
                    const ratio = originalWidth / originalHeight;
                    const iconWidth = targetHeight * ratio;
                    const iconHeight = targetHeight;
                    const iconX = 17; // Position X (5 pixels de plus à droite)
                    const iconY = 5; // Position Y (5 pixels plus haut)
                    
                    // Dessiner l'image avec ses proportions originales
                    ctx.save();
                    ctx.drawImage(icon, iconX, iconY, iconWidth, iconHeight);
                    ctx.restore();
                }
                
                // Dessiner le total en gris à droite avec label
                if (chart.options.plugins.customTotal) {
                    ctx.fillStyle = '#b0b0b0';
                    ctx.font = '14px "DejaVu Sans", sans-serif';
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'middle';
                    // Si customTotal est un objet avec label et value, utiliser ça, sinon format par défaut
                    const totalText = typeof chart.options.plugins.customTotal === 'object' 
                        ? chart.options.plugins.customTotal.text
                        : `Total de messages : ${chart.options.plugins.customTotal}`;
                    ctx.fillText(totalText, chart.width - 20, 35);
                }
                
                // Dessiner les labels manuellement avec police DejaVu
                if (chart.options.plugins.customLabels) {
                    const labels = chart.options.plugins.customLabels;
                    const xScale = chart.scales.x;
                    const yScale = chart.scales.y;
                    
                    ctx.save();
                    ctx.fillStyle = '#b0b0b0';
                    ctx.font = '11px "DejaVu Sans", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    
                    // Dessiner les labels de l'axe X
                    const maxLabels = 12;
                    const step = Math.ceil(labels.length / maxLabels);
                    labels.forEach((label, index) => {
                        if (index % step === 0) {
                            const x = xScale.getPixelForValue(index);
                            const y = chartArea.bottom + 10;
                            ctx.fillText(label, x, y);
                        }
                    });
                    
                    ctx.restore();
                }
            }
        };
        
        // Créer le service de rendu
        this.canvasRenderService = new ChartJSNodeCanvas({
            width: this.width,
            height: this.height,
            backgroundColour: '#36393f' // Couleur de fond Discord
        });
        
        // Enregistrer le plugin personnalisé
        this.customPlugin = customLegendPlugin;
    }

    // Générer un graphique d'activité (comme Statbot)
    async generateActivityChart(stats, iconPath = 'Messages.png') {
        // Préparer les données avec détection automatique du format (heure ou jour)
        const isHourlyData = stats.length > 0 && stats[0].hour !== undefined;
        
        console.log('📊 Type de données:', isHourlyData ? 'Horaire (24h)' : 'Journalier (30j)');
        console.log('📊 Nombre de points:', stats.length);
        
        const labels = stats.map(s => {
            if (isHourlyData) {
                // Format heure par heure : "14 heures"
                const date = new Date(s.hour);
                const hours = date.getHours();
                return `${hours} heures`;
            } else {
                // Format jour par jour : "11. Nov."
                const date = new Date(s.date);
                const day = date.getDate();
                const monthNames = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
                const month = monthNames[date.getMonth()];
                return `${day}. ${month}`;
            }
        });
        
        console.log('📊 Premiers labels:', labels.slice(0, 3));
        
        const messageData = stats.map(s => parseInt(s.message_count));
        
        // Calculer le total
        const totalMessages = messageData.reduce((sum, count) => sum + count, 0);
        
        // Charger l'icône si elle existe
        let iconImage = null;
        if (iconPath && fs.existsSync(iconPath)) {
            try {
                iconImage = await loadImage(iconPath);
            } catch (error) {
                console.warn('⚠️ Impossible de charger l\'icône:', error.message);
            }
        }

        // Configuration du graphique
        const configuration = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Messages',
                        data: messageData,
                        borderColor: 'rgb(99, 255, 132)', // Vert comme dans l'image
                        backgroundColor: 'rgba(99, 255, 132, 0.3)',
                        borderWidth: 3,
                        tension: 0.4, // Courbe lisse
                        fill: true, // Remplissage sous la courbe
                        pointRadius: 3, // Points visibles pour petites valeurs
                        pointBackgroundColor: 'rgb(99, 255, 132)',
                        pointBorderColor: 'rgb(99, 255, 132)',
                        pointHoverRadius: 6, // Points au survol
                        pointHoverBackgroundColor: 'rgb(99, 255, 132)',
                    }
                ]
            },
            plugins: [this.customPlugin],
            options: {
                layout: {
                    padding: {
                        top: 50, // Espace pour le titre personnalisé
                        left: 20,
                        right: 40, // Plus d'espace à droite pour éviter la coupure
                        bottom: 30 // Plus d'espace pour les labels
                    }
                },
                responsive: false,
                maintainAspectRatio: true,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: false
                    },
                    customTotal: totalMessages.toLocaleString('fr-FR'),
                    customIcon: iconImage,
                    customLabels: labels // Passer les labels au plugin personnalisé
                },
                scales: {
                    x: {
                        display: true, // Force l'affichage de l'axe
                        grid: {
                            display: true,
                            color: 'rgba(255, 255, 255, 0.05)',
                            drawBorder: true,
                            lineWidth: 1
                        },
                        ticks: {
                            display: false // Désactivé car on dessine manuellement dans le plugin
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        min: 0,
                        suggestedMax: Math.max(...messageData) < 5 ? 5 : (Math.max(...messageData) < 10 ? 10 : undefined), // Force un minimum pour la visibilité
                        grid: {
                            display: true,
                            color: 'rgba(255, 255, 255, 0.05)',
                            drawBorder: true,
                            lineWidth: 1
                        },
                        ticks: {
                            display: true,
                            color: '#b0b0b0',
                            font: {
                                size: 11,
                                family: '"DejaVu Sans", sans-serif' // Police DejaVu installée via Dockerfile
                            },
                            stepSize: Math.max(...messageData) < 5 ? 1 : undefined,
                            precision: 0,
                            padding: 8
                        }
                    }
                }
            }
        };

        // Générer l'image
        const imageBuffer = await this.canvasRenderService.renderToBuffer(configuration);
        return imageBuffer;
    }

    // Générer un graphique pour les personnages les plus utilisés
    async generateCharacterChart(topCharacters) {
        const labels = topCharacters.map(c => c.character_name || 'Inconnu');
        const data = topCharacters.map(c => parseInt(c.message_count));

        // Générer des couleurs dynamiques
        const colors = this.generateColors(topCharacters.length);

        const configuration = {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: false,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: true,
                        position: 'right',
                        labels: {
                            color: '#ffffff',
                            font: {
                                size: 12,
                                family: 'Arial'
                            },
                            padding: 15
                        }
                    },
                    title: {
                        display: true,
                        text: 'Top Personnages',
                        color: '#ffffff',
                        font: {
                            size: 16
                        }
                    }
                }
            }
        };

        const imageBuffer = await this.canvasRenderService.renderToBuffer(configuration);
        return imageBuffer;
    }

    // Générer des couleurs pour les graphiques
    generateColors(count) {
        const baseColors = [
            '#729bb6', // Couleur principale
            '#63ff84',
            '#ff6384',
            '#36a2eb',
            '#ffce56',
            '#4bc0c0',
            '#9966ff',
            '#ff9f40'
        ];

        const background = [];
        const border = [];

        for (let i = 0; i < count; i++) {
            const color = baseColors[i % baseColors.length];
            background.push(color + '80'); // Ajouter transparence
            border.push(color);
        }

        return { background, border };
    }

    // Générer un graphique simple (barres)
    async generateSimpleBarChart(labels, data, title) {
        const configuration = {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: title,
                    data: data,
                    backgroundColor: 'rgba(114, 155, 182, 0.6)',
                    borderColor: 'rgba(114, 155, 182, 1)',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: false,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: title,
                        color: '#ffffff',
                        font: {
                            size: 16
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#b9bbbe',
                            font: {
                                size: 11
                            }
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#b9bbbe',
                            font: {
                                size: 11
                            }
                        }
                    }
                }
            }
        };

        const imageBuffer = await this.canvasRenderService.renderToBuffer(configuration);
        return imageBuffer;
    }

    // Générer un graphique pour un utilisateur avec photo de profil
    async generateUserActivityChart(stats, avatarUrl, username) {
        // Préparer les données avec détection automatique du format (heure ou jour)
        const isHourlyData = stats.length > 0 && stats[0].hour !== undefined;
        
        const labels = stats.map(s => {
            if (isHourlyData) {
                // Format heure par heure : "14 heures"
                const date = new Date(s.hour);
                const hours = date.getHours();
                return `${hours} heures`;
            } else {
                // Format jour par jour : "11. Nov."
                const date = new Date(s.date);
                const day = date.getDate();
                const monthNames = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
                const month = monthNames[date.getMonth()];
                return `${day}. ${month}`;
            }
        });
        
        const messageData = stats.map(s => parseInt(s.message_count));
        
        // Calculer le total
        const totalMessages = messageData.reduce((sum, count) => sum + count, 0);
        
        // Charger l'avatar
        let avatarImage = null;
        try {
            avatarImage = await loadImage(avatarUrl);
        } catch (error) {
            console.warn('⚠️ Impossible de charger l\'avatar:', error.message);
        }

        // Charger l'icône Messages.png
        let iconImage = null;
        const iconPath = 'Messages.png';
        if (fs.existsSync(iconPath)) {
            try {
                iconImage = await loadImage(iconPath);
            } catch (error) {
                console.warn('⚠️ Impossible de charger l\'icône:', error.message);
            }
        }

        // Configuration du graphique
        const configuration = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Messages',
                        data: messageData,
                        borderColor: 'rgb(99, 255, 132)',
                        backgroundColor: 'rgba(99, 255, 132, 0.3)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 3,
                        pointBackgroundColor: 'rgb(99, 255, 132)',
                        pointBorderColor: 'rgb(99, 255, 132)',
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: 'rgb(99, 255, 132)',
                    }
                ]
            },
            plugins: [this.customPlugin],
            options: {
                layout: {
                    padding: {
                        top: 60, // Plus d'espace pour l'avatar et le pseudo
                        left: 20,
                        right: 40,
                        bottom: 30
                    }
                },
                responsive: false,
                maintainAspectRatio: true,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: false
                    },
                    customTotal: totalMessages.toLocaleString('fr-FR'),
                    customIcon: iconImage, // Icône Messages.png
                    userProfile: avatarImage ? {
                        avatar: avatarImage,
                        username: username
                    } : null,
                    customLabels: labels
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            display: true,
                            color: 'rgba(255, 255, 255, 0.05)',
                            drawBorder: true,
                            lineWidth: 1
                        },
                        ticks: {
                            display: false
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#b9bbbe',
                            font: {
                                size: 12
                            }
                        }
                    }
                }
            }
        };

        const imageBuffer = await this.canvasRenderService.renderToBuffer(configuration);
        return imageBuffer;
    }

    // Générer un graphique pour les membres (arrivées/départs)
    async generateMemberChart(stats, iconPath = 'Membres.png') {
        // Préparer les données avec détection automatique du format (heure ou jour)
        const isHourlyData = stats.length > 0 && stats[0].hour !== undefined;
        
        const labels = stats.map(s => {
            if (isHourlyData) {
                // Format heure par heure : "14 heures"
                const date = new Date(s.hour);
                const hours = date.getHours();
                return `${hours} heures`;
            } else {
                // Format jour par jour : "11. Nov."
                const date = new Date(s.date);
                const day = date.getDate();
                const monthNames = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
                const month = monthNames[date.getMonth()];
                return `${day}. ${month}`;
            }
        });
        
        const joinsData = stats.map(s => parseInt(s.joins));
        const leavesData = stats.map(s => parseInt(s.leaves));
        
        // Calculer les totaux
        const totalJoins = joinsData.reduce((sum, count) => sum + count, 0);
        const totalLeaves = leavesData.reduce((sum, count) => sum + count, 0);
        
        // Charger l'icône si elle existe
        let iconImage = null;
        if (iconPath && fs.existsSync(iconPath)) {
            try {
                iconImage = await loadImage(iconPath);
            } catch (error) {
                console.warn('⚠️ Impossible de charger l\'icône:', error.message);
            }
        }

        // Configuration du graphique avec 2 courbes
        const configuration = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Arrivées',
                        data: joinsData,
                        borderColor: 'rgb(99, 255, 132)', // Vert
                        backgroundColor: 'rgba(99, 255, 132, 0.3)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 3,
                        pointBackgroundColor: 'rgb(99, 255, 132)',
                        pointBorderColor: 'rgb(99, 255, 132)',
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: 'rgb(99, 255, 132)',
                    },
                    {
                        label: 'Départs',
                        data: leavesData,
                        borderColor: 'rgb(255, 99, 99)', // Rouge
                        backgroundColor: 'rgba(255, 99, 99, 0.3)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 3,
                        pointBackgroundColor: 'rgb(255, 99, 99)',
                        pointBorderColor: 'rgb(255, 99, 99)',
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: 'rgb(255, 99, 99)',
                    }
                ]
            },
            plugins: [this.customPlugin],
            options: {
                layout: {
                    padding: {
                        top: 50,
                        left: 20,
                        right: 40,
                        bottom: 30
                    }
                },
                responsive: false,
                maintainAspectRatio: true,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: false
                    },
                    customTotal: null, // Pas de total pour les stats membres
                    customIcon: iconImage,
                    customLabels: labels
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            display: true,
                            color: 'rgba(255, 255, 255, 0.05)',
                            drawBorder: true,
                            lineWidth: 1
                        },
                        ticks: {
                            display: false
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#b9bbbe',
                            font: {
                                size: 12
                            },
                            stepSize: 1, // Forcer les valeurs entières
                            precision: 0 // Pas de décimales
                        }
                    }
                }
            }
        };

        const imageBuffer = await this.canvasRenderService.renderToBuffer(configuration);
        return imageBuffer;
    }
}

module.exports = StatsGenerator;
