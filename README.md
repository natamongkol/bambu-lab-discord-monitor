# Bambu Lab Discord Monitor

Monitor Bambu Lab printers on Discord using MQTT protocol.
This tool sends notifications directly to your Discord channel.

## ✨ Features
* **Print Start:** Notification when the print job starts.
* **Error:** Alert when something goes wrong.
* **Print Finish:** Notification when the job is completed.
* **Multi-Printer:** Supports connecting multiple printers at once.

## 📸 Screenshots
<img width="822" height="751" alt="image" src="https://github.com/user-attachments/assets/a614c8db-88a7-49a2-8390-9ae7efe99420" />
<img width="479" height="361" alt="image" src="https://github.com/user-attachments/assets/95cd6089-5bfd-41cc-9497-226e95be8daf" />
<img width="479" height="361" alt="image" src="https://github.com/user-attachments/assets/b8f8837b-8cc7-424b-853b-880180383d83" />
<img width="479" height="361" alt="image" src="https://github.com/user-attachments/assets/aa58d591-fbcb-46d0-aabc-3a252dc51f67" />




## ⚙️ Installation

1.  **Clone the project**
    ```bash
    git clone https://github.com/natamongkol/bambu-lab-discord-monitor.git
    cd bambu-lab-discord-monitor
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Setup Configuration**
    * Open `config.json`.
    * Edit the file with your Discord Webhook URL and Printer details (IP, Access Code, Serial).

    ```json
    {
      "webhookUrl": "YOUR_DISCORD_WEBHOOK_URL",
      "saveLog": false,
      "printers": [
         {
      "name": "YOUR PRINTER NAME 1",
      "host": "YOUR PRINTER IP 1",
      "accessCode": "YOUR PRINTER ACCESS CODE 1",
      "serial": "YOUR PRINTER SERIAL NUMBER"
        },
      ]
    }
    ```

## 🚀 How to Run

```bash
npm start
