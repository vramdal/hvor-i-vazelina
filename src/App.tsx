import React, { ReactNode, RefObject, useEffect } from 'react';
import './App.scss';
import 'leaflet/dist/leaflet.css';
import { Feature, MapMarkerSpec, Song } from "./types";
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, } from 'react-leaflet';
import {
  Icon,
  LatLngBounds,
  Map as LeafletMap,
  Popup as LeafletPopup,
  Tooltip as LeafletTooltip,
} from "leaflet";
import classNames from "classnames";
import Game from "./Game";
import { loadMapFeatures, loadSongs } from "./fetchers";

type SongPlace = {
  name: string,
  id: number,
  coordinates: [number, number],
  radius: number
};
type SongRecord = {
  id: number,
  title: string,
  places: Array<SongPlace>

};
type MapBySongId = {[key: number]: SongRecord};

type PlaceMapRecord = { title: string, highlighted: boolean, songs: Array<{ id: number, title: string }> };

type PlaceMap = { [key: number]: PlaceMapRecord };

type MapMarkerDisplay = MapMarkerSpec & { highlighted: boolean, popup: RefObject<LeafletPopup>, tooltip: RefObject<LeafletTooltip> };

function highlightMarkers(placeIds: Array<number>, oldMapMarkers: Array<MapMarkerDisplay>) {
  return oldMapMarkers.map(marker => ({
    ...marker,
    highlighted: placeIds.includes(marker.id),
    lowlighted: !placeIds.includes(marker.id)
  }));
}


const adjustToViewBounds = (coordinatesList: Array<[number, number]>) => {
  const [firstPlace, ...otherPlaces] = coordinatesList;
  const place1 = {lng: firstPlace[0], lat: firstPlace[1]};
  const place2 = {lng: firstPlace[0] , lat: firstPlace[1]};
  const bounds = new LatLngBounds(place1, place2);
  for (const place of otherPlaces) {
    bounds.extend({lng: place[0], lat: place[1]});
  }
  // setBounds(bounds);
  return bounds;
}

function highlightPlaces(placesIds: Array<number>, mapMarkers: Array<MapMarkerDisplay>) {
  const allTooltips = mapMarkers.map(marker => marker.tooltip.current!.getElement()!);
  allTooltips.forEach(tooltip => tooltip.classList.remove("highlighted"));
  const markers = mapMarkers.filter(marker => placesIds.includes(marker.id));
  markers.forEach(marker => marker.tooltip.current!.getElement()!.classList.add("highlighted"));
}



function App(props: {mode: 'game' | 'atlas'}) {

  const [songs, setSongs] = React.useState<Array<Song>>([]);
  const [mapMarkers, setMapMarkers] = React.useState<Array<MapMarkerDisplay>>([]);
  const [bySongId, setBySongId] = React.useState<MapBySongId>({});
  const [byPlaceId, setByPlaceId] = React.useState<PlaceMap>({});
  const [songDisplay, setSongDisplay] = React.useState<Array<Song & {highlighted: boolean}>>([]);
  const [bounds, setBounds] = React.useState<LatLngBounds>();
  const [mapRef, setMapRef] = React.useState<LeafletMap | null>(null);
  const [isLoaded, setIsLoaded] = React.useState<boolean>(false);

  const featureToMarker: (feature: Feature) => MapMarkerDisplay = (feature: Feature) => {
    const coordinates = feature.geometry.coordinates;
    const { title, id} = feature.properties;
    return ({
      position: {
        lat: coordinates[1],
        lng: coordinates[0]
      },
      id,
      InfoWindowContent: `${title}`,
      highlighted: false,
      popup: React.createRef(),
      tooltip: React.createRef(),
    });
  }


  const mergeBySongId = (songs: Array<Song>, features: Array<Feature>) => {
    const mergedData : MapBySongId = {};
    for (const song of songs) {
      const places: Array<SongPlace> = song.places.map((placeName: string): SongPlace => {
        const placeGeo = features.find(feature => feature.properties?.title === placeName);
        if (!placeGeo) {
          console.warn("Finner ikke geo-spesifikasjon for " + placeName);
          return {
            id: -1,
            name: "",
            coordinates: [0, 0],
            radius: 0
          }
        }
        return {
          name: placeGeo.properties.title,
          id: placeGeo.properties.id,
          coordinates: placeGeo.geometry.coordinates,
          radius: placeGeo.properties.radius
        }
      }).filter(place => place.id !== -1);
      mergedData[song.id] = {
        id: song.id,
        title: song.title,
        places
      };
    }
    return mergedData;
  }

  const mergeByPlaceId = (songs: Array<Song>, features: Array<Feature>) => {
    const result : PlaceMap = {};
    for (const feature of features) {
      const placeId = feature.properties.id;
      result[placeId] = {
        title: feature.properties.title,
        highlighted: false,
        songs: songs.filter(song => song.places.includes(feature.properties.title)).map(song => ({id: song.id, title: song.title}))
      };
    }
    return result;
  }

  useEffect(() => {
    Promise.all([loadSongs(), loadMapFeatures()]).then(([songs, mapFeatures]) => {
      setSongs(songs);
      setBySongId(mergeBySongId(songs, mapFeatures));
      setByPlaceId(mergeByPlaceId(songs, mapFeatures));
      setMapMarkers(mapFeatures.map(featureToMarker));
      setIsLoaded(true);
    }).catch(err => {
      console.error(err);
      throw err;
    });
  }, []);

  useEffect(() => {
    setSongDisplay(songs.map(song => ({...song, highlighted: false})));
  }, [songs]);

  function highlightSongs(songs: Array<{ id: number; title: string }>) {

    const newSongDisplay = songDisplay.map(song => {
      const shouldBeHighlighted = songs.find(s => s.id === song.id) !== undefined;
      if (song.highlighted !== shouldBeHighlighted) {
        return ({
          ...song,
          highlighted: shouldBeHighlighted
        });
      } else {
        return song;
      }
    });
    setSongDisplay(newSongDisplay);
  }

  function scrollSongIntoView(songId: number) {
    document.getElementById(`song-${songId}`)!.scrollIntoView({
      behavior: "smooth",
      "block": "center"
    });
  }

  const markerClicked = (placeId: number) => {
    try {
      const songs = byPlaceId[placeId].songs;
      const firstSong = songs[0].id;
      if (props.mode === "atlas") { scrollSongIntoView(firstSong); }
      highlightSongs(songs);
      setMapMarkers(highlightMarkers([placeId], mapMarkers));
    } catch (e) {
      console.error(e);
      setSongDisplay(songDisplay.map(song => ({...song, highlighted: false})));
    }
  }

  const songClicked = (songId: number) => {
    const newSongDisplay = songDisplay.map(song => ({...song, highlighted: song.id === songId}));
    setSongDisplay(newSongDisplay);
    const places = bySongId[songId].places;
    const placeIds = places.map(place => place.id);
    setMapMarkers(highlightMarkers(placeIds, mapMarkers));
    highlightPlaces(placeIds, mapMarkers);
    setBounds(adjustToViewBounds(places.map(place => place.coordinates)));
    scrollSongIntoView(songId);
    mapRef!.closePopup();
  }

  const zoomToSong = React.useCallback((songId: number) => {
    const places = bySongId[songId].places;
    setBounds(adjustToViewBounds(places.map(place => place.coordinates)));
    setMapMarkers(mapMarkers => highlightMarkers(places.map(place => place.id), mapMarkers));
  }, [bySongId, setMapMarkers, setBounds]);

  const showSongTooltips = React.useCallback((songId: number) => {
    setMapMarkers(mapMarkers => {
      const places = bySongId[songId].places;
      highlightPlaces(places.map(place => place.id), mapMarkers);
      return mapMarkers;
    });
  }, [bySongId, setMapMarkers]);

  const removeHighlighting = React.useCallback(() => {
    setMapMarkers(
      mapMarkers => {
        highlightPlaces([], mapMarkers);
        return highlightMarkers([], mapMarkers);
      }
    );
  }, [setMapMarkers]);

  return (
    <>
      {props.mode === "atlas" && <header>
          <h1>Vazelina-atlas</h1>
      </header>}
      {props.mode === "game" && <header>
          {/*<h1>Hvor i Vazelina-verden?</h1>*/}
      </header>}
      <div id="vazelina-app">
        {props.mode === "atlas" && <aside>
            <h1>Sanger</h1>
            <table>
                <tbody>
                {songDisplay.map(song =>
                  <tr key={song.id}
                      className={classNames("song-row", {highlighted: song.highlighted, disabled: song.places.length === 0, enabled: song.places.length > 0})}
                      id={"song-" + song.id}>
                    <td onClick={() => songClicked(song.id)}>{song.title}</td>
                  </tr>)}
                </tbody>
            </table>
        </aside>}
        <main className={classNames("app-mode", props.mode)}>
          <MapContainer center={[
            60.659538204723106,
            10.698810319462064
          ]
          } zoom={10} scrollWheelZoom={true} bounds={bounds}
                        ref={setMapRef}
          >

            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. <a href="https://www.flaticon.com/free-icons/axe" title="axe icons">Axe icons created by Those Icons - Flaticon</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {isLoaded &&
                <Game songs={songs}
                      zoomToSong={zoomToSong}
                      showSongTooltips={showSongTooltips}
                      removeHighlighting={removeHighlighting}
                />}
            <MyMapContainer bounds={bounds}>
              <>
                {mapMarkers.map(marker => {
                  const icon: Icon = new Icon({
                    iconUrl: "/hvor-i-vazelina/oks-mapmarker.png",
                    iconSize: (marker.highlighted ? [30, 40] : [20, 30]),
                    attribution: "<a href=\"https://www.flaticon.com/free-icons/axe\" title=\"axe icons\">Axe icons created by Those Icons - Flaticon</a>",
                    className: classNames("map-marker", {highlighted: marker.highlighted, lowlighted: !marker.highlighted}),
                    tooltipAnchor: [25, 0]
                  });
                  return <Marker eventHandlers={{
                    click: () => {
                      if (props.mode === "atlas") markerClicked(marker.id);
                    }
                  }} icon={icon} position={[marker.position.lat, marker.position.lng]} key={marker.id}
                                 interactive={true}>
                    {props.mode === "atlas" && <Popup ref={marker.popup} className={"map-marker-popup"}  >
                        <h3>{marker.InfoWindowContent}</h3>
                        <ul>
                          {byPlaceId[marker.id].songs.map(song => <li key={song.id}
                                                                      onClick={() => songClicked(song.id)}>{song.title}</li>)}
                        </ul>
                    </Popup>}
                    <Tooltip className={classNames("map-marker-tooltip", {highlightedLaks: marker.highlighted})} direction={"right"} permanent ref={marker.tooltip}>{marker.InfoWindowContent}</Tooltip>
                  </Marker>;
                })}
              </>
            </MyMapContainer>
          </MapContainer>
        </main>
      </div>
    </>
  );
}

const MyMapContainer = ({bounds, children } : {bounds?: LatLngBounds, children: ReactNode}) => {

  const myMap = useMap();

  useEffect(() => {
    if (bounds) {
      myMap.flyToBounds(bounds, {padding: [20, 20], paddingBottomRight: [0, 350], animate: true, maxZoom: 15, duration: 2});
    }
  }, [bounds, myMap]);


  return <>{children}</>;
};


export default App;
