import { Button, SafeAreaView, Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
const api = 'https://samurai-meet.disnana.com/api/v1';
export default function App() { return <SafeAreaView><Text>API: {api}</Text><Button title="Googleでログイン" onPress={() => WebBrowser.openBrowserAsync(`${api}/auth/google/start`)} /></SafeAreaView>; }
