// couleurs des points
const COULEURS = { prise_de_vue: '#e4572e', represente: '#0382d1' };

// Memobase : identifiant = "blt-001-" + numéro d'inventaire sur 9 chiffres
// ex. inventaire 399096 -> blt-001-000399096
// add an IIIF link to embed memobase images
function idMemobase(inv) {
    return 'blt-001-' + String(inv).padStart(9, '0');
}
function lienMemobase(inv) {
    return 'https://memobase.ch/fr/object/' + idMemobase(inv);
}
function lienApi(inv) {
    return 'https://api.memobase.ch/record/' + idMemobase(inv) + '?format=json';
}
function lienIIIF(inv) {
    return 'https://media.memobase.ch/memo/' +
        idMemobase(inv) + '-1/iiif/full/full/0/default.jpg';
}

// emprise de la Suisse (sud-ouest, nord-est) en WGS84
var SUISSE = L.latLngBounds([45.80, 5.95], [47.82, 10.50]);

// carte cadrée sur la Suisse, quelle que soit la taille de l'écran
var mymap = L.map('map', { maxZoom: 18, zoomSnap: 0.25 });
mymap.fitBounds(SUISSE);
mymap.setMinZoom(mymap.getZoom());
mymap.setMaxBounds(SUISSE.pad(0.15));

// fonds de carte swisstopo
var attribution = '&copy; <a href="https://www.swisstopo.admin.ch">swisstopo</a>';
function coucheSwisstopo(nom) {
    return L.tileLayer('https://wmts.geo.admin.ch/1.0.0/' + nom + '/default/current/3857/{z}/{x}/{y}.jpeg',
        { maxZoom: 18, attribution: attribution });
}
var carteGrise = coucheSwisstopo('ch.swisstopo.pixelkarte-grau').addTo(mymap);
L.control.layers({
    "Carte grise": carteGrise,
    "Carte couleur": coucheSwisstopo('ch.swisstopo.pixelkarte-farbe'),
    "SWISSIMAGE": coucheSwisstopo('ch.swisstopo.swissimage')
}).addTo(mymap);


// ---------- points sur la carte ----------

function stylePoint(type, actif) {
    return {
        radius: actif ? 10 : 7,
        color: actif ? '#000' : '#fff',
        weight: actif ? 3 : 1.5,
        fillColor: COULEURS[type],
        fillOpacity: 0.9
    };
}

var pointActif = null;
var photosGeo = photos.features.filter(f => f.geometry != null);
var couchePoints = L.layerGroup().addTo(mymap);

// on crée chaque point une seule fois, le filtre les ajoute/retire ensuite
var points = photosGeo.map(function (f) {
    var c = f.geometry.coordinates;
    var point = L.circleMarker([c[1], c[0]], stylePoint(f.properties.type_lieu, false))
        .bindTooltip(f.properties.titre ?? 'Sans titre');
    point.photo = f.properties;

    point.on('click', function (e) {
        L.DomEvent.stopPropagation(e); // sinon le clic sur la carte vide la colonne
        selectionner(point);
    });
    return point;
});

function selectionner(point) {
    if (pointActif) pointActif.setStyle(stylePoint(pointActif.photo.type_lieu, false));
    pointActif = point;
    if (point) {
        point.setStyle(stylePoint(point.photo.type_lieu, true)).bringToFront();
        afficherInfos(point.photo);
    } else {
        document.getElementById('infos').innerHTML =
            '<p class="vide">Aucune photo sélectionnée.<br>Cliquer sur un point de la carte.</p>';
    }
}

// clic à côté des points : vider la colonne
mymap.on('click', function () { selectionner(null); });


// ---------- slider des dates ----------

var annees = photosGeo.map(f => f.properties.annee).filter(a => a != null);
var ANNEE_MIN = Math.min(...annees);
var ANNEE_MAX = Math.max(...annees);

var sliderDebut = document.getElementById('slider_debut');
var sliderFin = document.getElementById('slider_fin');
[sliderDebut, sliderFin].forEach(function (s) {
    s.min = ANNEE_MIN;
    s.max = ANNEE_MAX;
    s.addEventListener('input', filtrerDates);
});
sliderDebut.value = ANNEE_MIN;
sliderFin.value = ANNEE_MAX;
document.getElementById('sans_date').addEventListener('change', filtrerDates);

function filtrerDates() {
    // les deux poignées ne peuvent pas se croiser
    if (parseInt(sliderDebut.value) > parseInt(sliderFin.value)) {
        if (this === sliderDebut) sliderDebut.value = sliderFin.value;
        else sliderFin.value = sliderDebut.value;
    }
    var debut = parseInt(sliderDebut.value);
    var fin = parseInt(sliderFin.value);
    var sansDate = document.getElementById('sans_date').checked;

    couchePoints.clearLayers();
    var n = 0;
    points.forEach(function (point) {
        var a = point.photo.annee;
        var visible = (a == null) ? sansDate : (a >= debut && a <= fin);
        if (visible) {
            couchePoints.addLayer(point);
            n++;
        }
    });

    // si la photo sélectionnée disparaît, on vide la colonne
    if (pointActif && !couchePoints.hasLayer(pointActif)) selectionner(null);

    document.getElementById('annee_debut').textContent = debut;
    document.getElementById('annee_fin').textContent = fin;
    document.getElementById('compte').textContent = n + ' photos affichées';
}


// ---------- colonne d'informations ----------

function texteLieu(l) {
    if (!l) return null;
    var t = l.nom ?? '';
    if (l.e) t += ' <span class="coord">(' + l.e.toLocaleString('fr-CH') + ' / ' + l.n.toLocaleString('fr-CH') + ')</span>';
    return t;
}

function afficherInfos(p) {
    var lignes = [
        ['Description', p.description],
        ['Date', p.date_texte ?? (p.annee ? String(p.annee) : 'inconnue')],
        ['Lieu représenté', texteLieu(p.lieu_represente)],
        ['Lieu de prise de vue', texteLieu(p.lieu_prise_de_vue)],
        ['Auteur', p.auteur],
        ['Remarque', p.remarque],
        ['N° d\'inventaire', p.inv],
        ['Numéro', p.numero],
        ['Statut', p.statut]
    ];

    var html = '<h3>' + (p.titre ?? 'Sans titre') + '</h3>';
    html += '<div id="image" class="image"><span class="chargement">Chargement de l\'image…</span></div>';
    html += '<p><a href="' + lienMemobase(p.inv) + '" target="_blank">Voir sur Memobase ↗</a></p>';
    html += '<table>';
    lignes.forEach(function ([label, valeur]) {
        if (valeur != null && valeur !== '') {
            html += '<tr><td class="label">' + label + '</td><td>' + valeur + '</td></tr>';
        }
    });
    html += '</table>';
    document.getElementById('infos').innerHTML = html;

    chargerImage(p.inv);
}


// ---------- image depuis Memobase ----------

// cherche dans la notice JSON-LD toutes les adresses qui ressemblent à une image --- deprecated
function trouverImages(objet, resultats = []) {
    if (typeof objet === 'string') {
        if (/^https?:\/\/.*(iiif|\.jpe?g|\.png|\.tiff?|\/master|thumbnail)/i.test(objet)) resultats.push(objet);
    } else if (objet && typeof objet === 'object') {
        Object.values(objet).forEach(v => trouverImages(v, resultats));
    }
    return resultats;
}

// une adresse IIIF "info.json" ou de base -> une image de 600 px de large --- deprecated
function versImage(url) {
    if (/\/info\.json$/.test(url)) return url.replace(/info\.json$/, 'full/600,/0/default.jpg');
    if (/iiif/i.test(url) && !/default\.jpg/.test(url) && !/manifest/i.test(url)) {
        return url.replace(/\/$/, '') + '/full/600,/0/default.jpg';
    }
    return url;
}

// updated chargerImage() to support IIIF images
function chargerImage(inv) {
    var boite = document.getElementById('image');
    if (!boite) return;

    var url = lienIIIF(inv);

    console.log('Image IIIF Memobase :', url);

    var img = new Image();
    img.alt = 'Image Memobase ' + inv;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';

    img.onload = function () {
        if (document.getElementById('image') === boite) {
            boite.replaceChildren(img);
        }
    };

    img.onerror = function () {
        console.warn('Image Memobase introuvable :', url);

        if (document.getElementById('image') === boite) {
            boite.innerHTML =
                '<span class="chargement">' +
                'Image non disponible ici. ' +
                '<a href="' + lienMemobase(inv) +
                '" target="_blank" rel="noopener noreferrer">' +
                'Ouvrir sur Memobase</a></span>';
        }
    };

    boite.textContent = 'Chargement de l’image…';
    img.src = url;
}

// essaie les adresses une par une jusqu'à ce qu'une image s'affiche --- deprecated
function essayerImages(urls, boite, inv) {
    if (!urls.length) {
        boite.innerHTML = '<span class="chargement">Image non disponible ici.</span>';
        return;
    }
    var img = new Image();
    img.alt = 'Photo ' + inv;
    img.onload = function () {
        if (document.getElementById('image') !== boite) return; // une autre photo a été cliquée entre-temps
        boite.innerHTML = '';
        var a = document.createElement('a');
        a.href = lienMemobase(inv);
        a.target = '_blank';
        a.appendChild(img);
        boite.appendChild(a);
    };
    img.onerror = function () { essayerImages(urls.slice(1), boite, inv); };
    img.src = urls[0];
}


// ---------- initialisation ----------
document.getElementById('resume').textContent =
    photosGeo.length + ' photos géolocalisées sur ' + photos.features.length + ' dans la collection.';
filtrerDates();
