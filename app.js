var { LMap, LTileLayer, LMarker, LPopup } = Vue2Leaflet;

new Vue({
  el: '#app',
  components: { LMap, LTileLayer, LMarker, LPopup },
  data() {
    return {
      zoom:13,
      center: L.latLng(58.38, 26.7225),
      url:'http://{s}.tile.osm.org/{z}/{x}/{y}.png',
      attribution:'&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
      RED_PROXIMITY: 500, //meters
      AREA_MAXLENGTH: 50,
      markers: [],
      markersDraggable: true,
      newmarker: null,
      elCoordsValue: null,
      elTitleValue: "",
      elDescValue: "",
      mapCursor: null,
      distGraph: null,
      greenIcon: null,
      yellowIcon: null,
      redIcon: null,
    }
  },
  mounted() {
    this.init();
  },
  watch: {
   markers: function () {
    if (typeof(Storage) !== "undefined") {
      var storeMarkers = [];
      for (var i = 0; i < this.markers.length; i++) {
          storeMarkers[i] = new Object();
          storeMarkers[i].id = this.markers[i].id;
          storeMarkers[i].position = this.markers[i].position;
          storeMarkers[i].title = this.markers[i].title;
          storeMarkers[i].desc = this.markers[i].desc;
      }
      localStorage.setItem('storedData', JSON.stringify(storeMarkers) )
    }
   }
  },
  methods: {
    init() {
      var LeafIcon = L.Icon.extend({
        options: {
          shadowUrl: 'img/marker-shadow.png',
          iconSize:     [25, 41],
          shadowSize:   [55, 59],
          iconAnchor:   [14, 40],
          shadowAnchor: [16, 62],
          popupAnchor:  [-3, -35]
        }
      });
      this.greenIcon = new LeafIcon({iconUrl: 'img/marker-icon-g.png'});
      this.yellowIcon = new LeafIcon({iconUrl: 'img/marker-icon-y.png'});
      this.redIcon = new LeafIcon({iconUrl: 'img/marker-icon-r.png'});
      this.distGraph = new Graph();
      console.log(localStorage.getItem('storedData') );
      if (typeof(Storage) !== "undefined" && JSON.parse(localStorage.getItem('storedData')) != null ) {
        this.markers = JSON.parse(localStorage.getItem('storedData'));
        var bounds = [];
        for (var i = 0; i < this.markers.length; i++) {
            bounds[i] = this.markers[i].position;
        }
        this.$refs.map.mapObject.fitBounds( bounds, {padding: [50, 50]} );
        this.calcDistances();
        this.findClosest();
      }
    },
    waitForMarker() {
      this.mapCursor = 'crosshair';
      this.$refs.map.mapObject.on('click', this.onMapClick);
      this.markersDraggable = false;
    },
    resetInput() {
      if (this.mapCursor != null) {
        this.$refs.map.mapObject.off('click', null);
        this.mapCursor = null;
      }
      this.newmarker = null;
      this.elCoordsValue = null;
      this.elTitleValue = "";
      this.elDescValue = "";
      this.markersDraggable = true;
    },
    saveMarker() {
      this.newmarker.icon = this.greenIcon;
      this.newmarker.title = this.stripHtml( this.elTitleValue );
      this.newmarker.desc = this.stripHtml( this.elDescValue ).substring(0, this.AREA_MAXLENGTH);
      this.newmarker.closest = null;
      this.newmarker.closestDist = null;
      this.markers.push(this.newmarker);

      this.calcDistances(this.newmarker);
      this.findClosest(this.newmarker, true);
      this.resetInput();
    },
    popupMsg(title, desc) {
        var popupMsg = '';
        if (title) popupMsg = '<b>' + title + '</b>';
        if (desc) popupMsg += '<br/>' + desc;
        return popupMsg;
    },
    coordsToString(latlng) {
      return latlng.lat.toFixed(6) + ", " + latlng.lng.toFixed(6);
    },
    stripHtml(inText) {
        var tmp = document.createElement("DIV");
        tmp.innerHTML = inText;
        return tmp.textContent || tmp.innerText || "";
    },
    areaOnKeyDown(e) {
      if (this.elDescValue.length >= this.AREA_MAXLENGTH) {
        if (e.keyCode >= 48 && e.keyCode <= 90) {
          e.preventDefault();
          return
        }
      }
    },
    onMapClick(e) {
      this.elCoordsValue = this.coordsToString(e.latlng);
      this.newmarker = new Object();
      if (this.markers.length) {
        this.newmarker.id = this.markers[this.markers.length - 1].id + 1;
      } else {
        this.newmarker.id = 1;
      }
      this.newmarker.icon = this.yellowIcon;
      this.newmarker.position = e.latlng;
      console.log("You clicked the map at " + e.latlng);
      //turn clicking off
      this.mapCursor = null;
      this.$refs.map.mapObject.off('click', null);
    },
    markerMoved(e) {
      var marker = this.getMarkerById(e.target.options.markerId);
      this.calcDistances( marker );
      this.findClosest(marker, true);
      console.log("Marker " + e.target.options.markerId + " moved to: " + e.target.getLatLng());
      // refresh array view
      Vue.set(this.markers, 0, this.markers[0]);
    },
    getMarkerById(mId) {
      for (var i = 0; i < this.markers.length; i++) {
        if (this.markers[i].id == mId) {
          return this.markers[i];
        }
      }
      return null;
    },
    removeMarker(index) {
      var marker = this.markers[index];
      this.distGraph.drop(marker.id);
      this.markers.splice(index, 1);
      this.findClosestForDeletedNodeConnections(marker);
    },
    markerRowClicked(mId) {
        var markerRefName = "m-" + mId;
        var leafletMarker = this.$refs[markerRefName][0].mapObject;
        leafletMarker.openPopup();
    },
    calcDistances(dForMarker = null) {
      function getDistanceFromLatLonInM(lat1,lon1,lat2,lon2) {
        var R = 6371000; // Radius of the earth in m
        var dLat = deg2rad(lat2-lat1);  // deg2rad below
        var dLon = deg2rad(lon2-lon1);
        var a =
          Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
          Math.sin(dLon/2) * Math.sin(dLon/2)
          ;
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        var d = Math.round(R * c); // Distance in m
        return d;
      }

      function deg2rad(deg) {
        return deg * (Math.PI/180)
      }

      if (this.markers.length > 1) {
        if (dForMarker) {
          for (var i = 0; i < this.markers.length; i++) {
            if (this.markers[i] != dForMarker) {
              //console.log("Kaugus " + dForMarker.id + " -> " + this.markers[i].id);
              var dist = getDistanceFromLatLonInM(dForMarker.position.lat, dForMarker.position.lng,
                           this.markers[i].position.lat, this.markers[i].position.lng);
              this.distGraph.set(dForMarker.id, this.markers[i].id, dist);
              //console.log(dist);
            }
          }
        } else {
          for (var i = 0; i < (this.markers.length-1); i++) {
              for (var j = (i+1); j < this.markers.length; j++) {
                //console.log("Kaugus " + this.markers[i].id + " -> " + this.markers[j].id);
                var dist = getDistanceFromLatLonInM(this.markers[i].position.lat, this.markers[i].position.lng,
                             this.markers[j].position.lat, this.markers[j].position.lng);
                this.distGraph.set(this.markers[i].id, this.markers[j].id, dist);
                //console.log(dist);
              }
          }
        }
      }

    },
    findClosestForDeletedNodeConnections(deletedMarker) {
      if (this.markers.length == 1) {
        this.markers[0].closest = null;
        this.markers[0].closestDist = null;
      } else if (this.markers.length > 1) {
        for (var i = 0; i < this.markers.length; i++) {
          if (this.markers[i].closest == deletedMarker) {
            this.findClosest(this.markers[i]);
          }
        }
      }
    },
    findClosest(cForMarker = null, checkConnectedNodes = false) {
      if (this.markers.length == 1) {
        this.markers[0].closest = null;
        this.markers[0].closestDist = null;
      } else if (this.markers.length > 1) {
        if (cForMarker) {
          let {fromNode, withMinWeight, minWeight} = this.distGraph.withMinWeight(cForMarker.id);
          cForMarker.closestDist = minWeight;
          cForMarker.closest = this.getMarkerById(withMinWeight);
          if (cForMarker.closestDist < this.RED_PROXIMITY) {
            cForMarker.icon = this.redIcon;
          } else {
            cForMarker.icon = this.greenIcon;
          }
          if (checkConnectedNodes) {
            for (var i = 0; i < this.markers.length; i++) {
              if (this.markers[i] != cForMarker) {
                if (this.markers[i].closest == null)
                  this.markers[i].closest = cForMarker;
                if (this.markers[i].closest == cForMarker) {
                  this.findClosest(this.markers[i]);
                } else {
                  var dist = this.distGraph.get(cForMarker.id, this.markers[i].id);
                  if (dist < this.markers[i].closestDist) {
                    this.markers[i].closestDist = dist;
                    this.markers[i].closest = cForMarker;
                  }
                  if (this.markers[i].closestDist < this.RED_PROXIMITY) {
                    this.markers[i].icon = this.redIcon;
                  }
                }
              }
            }
          }
        } else {
          for (var i = 0; i < this.markers.length; i++) {
            let {fromNode, withMinWeight, minWeight} = this.distGraph.withMinWeight(this.markers[i].id);
            this.markers[i].closestDist = minWeight;
            this.markers[i].closest = this.getMarkerById(withMinWeight);
            if (this.markers[i].closestDist < this.RED_PROXIMITY) {
              this.markers[i].icon = this.redIcon;
            } else {
              this.markers[i].icon = this.greenIcon;
            }
          }
        }
      }
    },
  },

});
