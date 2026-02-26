// mockData.js
// Provides dummy API responses to save Quota during local UI development

const mockChannelInfo = {
    kind: "youtube#channelListResponse",
    etag: "mock_etag",
    pageInfo: { totalResults: 1, resultsPerPage: 5 },
    items: [
        {
            kind: "youtube#channel",
            etag: "mock_etag",
            id: "UC_mock_channel_id",
            snippet: {
                title: "KiddoLens Demo Channel",
                description: "This is a mock channel used for testing KiddoLens.",
                thumbnails: { default: { url: "https://ui-avatars.com/api/?name=Demo&size=88&background=random" } }
            },
            contentDetails: { relatedPlaylists: { uploads: "UU_mock_uploads_id" } },
            statistics: { subscriberCount: "1350000" }
        }
    ]
};

const mockPlaylistItems = {
    kind: "youtube#playlistItemListResponse",
    etag: "mock_etag",
    nextPageToken: null,
    pageInfo: { totalResults: 6, resultsPerPage: 20 },
    items: Array.from({ length: 6 }).map((_, i) => ({
        kind: "youtube#playlistItem",
        etag: "mock_etag",
        id: `mock_playlist_item_${i}`,
        snippet: {
            publishedAt: new Date(Date.now() - i * 86400000).toISOString(),
            channelId: "UC_mock_channel_id",
            title: `Demo Kiddo Video ${i + 1} - Learning is Fun!`,
            description: "Mock video description.",
            thumbnails: {
                medium: { url: `https://picsum.photos/seed/mockvid${i}/320/180` },
                high: { url: `https://picsum.photos/seed/mockvid${i}/480/360` }
            },
            channelTitle: "KiddoLens Demo Channel",
            playlistId: "UU_mock_uploads_id",
            resourceId: { kind: "youtube#video", videoId: `mock_video_${i}` }
        }
    }))
};

const mockVideoDetails = {
    kind: "youtube#videoListResponse",
    etag: "mock_etag",
    items: Array.from({ length: 6 }).map((_, i) => ({
        kind: "youtube#video",
        etag: "mock_etag",
        id: `mock_video_${i}`,
        contentDetails: {
            duration: i === 0 ? "PT45S" : `PT${Math.floor(Math.random() * 10) + 2}M15S` // Mix of shorts and long
        }
    }))
};

const mockSearchChannels = {
    kind: "youtube#searchListResponse",
    etag: "mock_etag",
    nextPageToken: "mock_next",
    regionCode: "TW",
    pageInfo: { totalResults: 3, resultsPerPage: 6 },
    items: [
        {
            kind: "youtube#searchResult",
            etag: "mock_etag",
            id: { kind: "youtube#channel", channelId: "UC_mock_1" },
            snippet: {
                publishedAt: "2015-01-01T00:00:00Z",
                channelId: "UC_mock_1",
                title: "Mock Cocomelon",
                description: "Dummy search result 1",
                thumbnails: { default: { url: "" } },
                channelTitle: "Mock Cocomelon"
            }
        },
        {
            kind: "youtube#searchResult",
            etag: "mock_etag",
            id: { kind: "youtube#channel", channelId: "UC_mock_2" },
            snippet: {
                publishedAt: "2018-05-10T00:00:00Z",
                channelId: "UC_mock_2",
                title: "Mock Peppa Pig",
                description: "Dummy search result 2",
                thumbnails: { default: { url: "" } },
                channelTitle: "Mock Peppa Pig"
            }
        },
        {
            kind: "youtube#searchResult",
            etag: "mock_etag",
            id: { kind: "youtube#channel", channelId: "UC_mock_3" },
            snippet: {
                publishedAt: "2020-11-20T00:00:00Z",
                channelId: "UC_mock_3",
                title: "Mock Blippi",
                description: "Dummy search result 3",
                thumbnails: { default: { url: "" } },
                channelTitle: "Mock Blippi"
            }
        }
    ]
};

export async function getMockData(url) {
    return new Promise((resolve) => {
        setTimeout(() => {
            if (url.includes('channels?part=contentDetails')) resolve(mockChannelInfo);
            else if (url.includes('channels?part=statistics')) resolve(mockChannelInfo);
            else if (url.includes('channels?part=snippet')) resolve(mockChannelInfo);
            else if (url.includes('playlistItems')) resolve(mockPlaylistItems);
            else if (url.includes('videos?part=contentDetails')) resolve(mockVideoDetails);
            else if (url.includes('search?part=snippet&type=channel')) resolve(mockSearchChannels);
            else resolve({ items: [] });
        }, 300); // Simulate network latency
    });
}
