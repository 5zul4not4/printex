# PrintEase — Cloud-Backed Print Shop System

This is a Next.js application for "PrintEase", a cloud-backed print shop system. It includes a user-facing app (Print-X), an admin panel (PrintAdmin), and a backend built with Next.js.

## Overview

PrintEase allows customers to upload documents, get instant page counts, pay for print jobs, and have them automatically printed at a local print shop. The admin panel provides tools for managing printers, jobs, pricing, and viewing reports.

### Core Features

*   **PDF Upload and Instant Page Count**: Users can upload PDF files and see the page count immediately, calculated on the client-side.
*   **UPI Payment Integration**: A seamless payment flow using UPI, integrated with a payment gateway (in sandbox mode).
*   **Automated Print Queue**: Paid jobs are automatically added to a print queue in Firestore.
*   **Local Connector Agent**: A script (to be run on the shop's PC) listens for new jobs and prints them automatically.
*   **Admin Dashboard**: A comprehensive interface for admins to manage the print shop's operations.
*   **AI-Powered Edit Summary**: An AI-powered feature to summarize changes made by an admin during an "Edit & Print" job.

## Getting Started

### Prerequisites

*   Node.js (v18 or later)
*   npm, yarn, or pnpm
*   Firebase Project (for Firestore and Storage)

### Environment Variables

Create a `.env.local` file in the root of the project and add your Firebase configuration:

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# For Genkit AI features
GOOGLE_API_KEY=
```

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run the development server:
    ```bash
    npm run dev
    ```

The application will be available at `http://localhost:9002`.
*   User App: `http://localhost:9002`
*   Admin Panel: `http://localhost:9002/admin`

## Deployment (Going Public)

To make your application accessible to anyone on the internet, you need to deploy it. Since this is a Next.js application using Firebase, the recommended method is **Firebase App Hosting**.

1.  **Install Firebase CLI:** If you haven't already, install the Firebase Command Line Interface globally.
    ```bash
    npm install -g firebase-tools
    ```

2.  **Login to Firebase:**
    ```bash
    firebase login
    ```

3.  **Initialize Hosting:** In your project root, run the init command.
    ```bash
    firebase init hosting
    ```
    Follow the prompts, select your project, and choose "App Hosting" as the hosting type.

4.  **Deploy:** This command will build your Next.js app and upload it to Firebase's global servers.
    ```bash
    firebase deploy
    ```

After deployment, you will get a public URL (e.g., `https://your-project-id.web.app`). This is your live website.

### Is it free to deploy? (Blaze Plan Explained)

Yes, you can get started for free. However, Firebase App Hosting **requires your project to be on the Blaze (pay-as-you-go) plan**. Here's what that means:

*   **Why is Blaze required?** App Hosting uses advanced Google Cloud services that require a billing account to be enabled.
*   **You Still Get the Free Tier:** The Blaze plan **includes the same generous free tier** as the free Spark plan. You do not pay anything until your usage *exceeds* the free limits.
*   **Conclusion:** For a new application like this, you will almost certainly stay within the free tier and incur **no costs**. You only need to upgrade to Blaze to enable the feature, but your bill will be $0 until your app's usage grows significantly.

## Local Connector Agent

The local connector is a crucial part of the system that runs on the print shop's Windows PC. It connects to Firebase, listens for print jobs, and sends them to the local printers. **This script is not deployed to the cloud.**

For detailed instructions on setting up and running the agent, please refer to the `local-connector/README.md` file.

## Testing

*   **Page Counting**: Upload a PDF on the order page to see the instant page count.
*   **Payment Flow**: The payment flow is currently mocked. Clicking "Pay" will simulate a successful payment and queue the job.
*   **Admin Panel**: Navigate to `/admin` to access the admin dashboard. Note that authentication is not implemented in this version.
*   **AI Summary**: In the admin panel, go to "Edit Requests", open a request, and use the "Summarize Changes" tool to test the AI feature.
